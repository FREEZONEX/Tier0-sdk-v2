import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createDataClient,
  DataError,
  defineCollection,
  redactRestricted,
  runWithRequestContext,
  type SubscriptionEvent,
} from '../../src/data/index.js';

const orders = defineCollection({ alias: 'orders', name: '生产工单', schema: z.object({ code: z.string() }) });
const lines = defineCollection({ alias: 'lines', name: '工单明细', schema: z.object({ sku: z.string() }) });
const silent = { info() {}, warn() {}, error() {} };
const SUBSCRIBE = '/openapi/v2/uns/records:subscribe';

const ensured = {
  code: 200, msg: 'ok', requestId: 'req-ensure',
  data: {
    appId: 'app-1',
    results: [
      { alias: 'orders', collectionId: 'c-orders', revision: 1, status: 'unchanged' },
      { alias: 'lines', collectionId: 'c-lines', revision: 1, status: 'unchanged' },
    ],
  },
};

interface Opened {
  url: URL;
  headers: Record<string, string>;
}

/** One scripted connection: SSE frames to send, then end (or stay open when `hold`). */
type Connection = { frames: string[]; hold?: boolean } | { status: number; body: unknown };

function change(eventId: string, extra: Record<string, unknown> = {}) {
  const body = { eventId, collectionId: 'c-orders', recordId: 'o-1', revision: 2, change: 'record', occurredAt: 1000, restricted: false, ...extra };
  return `id: ${eventId}\nevent: change\ndata: ${JSON.stringify(body)}\n\n`;
}

function sse(connections: Connection[], ensures: unknown[] = [ensured]) {
  const opened: Opened[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/uns/app/collections/ensure')) {
      const body = (ensures.length > 1 ? ensures.shift() : ensures[0]) as { code: number };
      return new Response(JSON.stringify(body), { status: body.code });
    }
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    opened.push({ url, headers });
    const next = connections.length > 1 ? connections.shift()! : connections[0];
    if ('status' in next) return new Response(JSON.stringify(next.body), { status: next.status });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of next.frames) controller.enqueue(encoder.encode(frame));
        if (!next.hold) controller.close();
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }) as typeof globalThis.fetch;
  return { fetch, opened };
}

function client(fetch: typeof globalThis.fetch) {
  return createDataClient({ collections: [orders, lines], fetch, apiHost: 'http://gw.local', apiKey: 'sk-app', logger: silent });
}

async function take(iterable: AsyncIterable<SubscriptionEvent>, count: number): Promise<SubscriptionEvent[]> {
  const out: SubscriptionEvent[] = [];
  for await (const event of iterable) {
    out.push(event);
    if (out.length === count) break;
  }
  return out;
}

const refusal = (status: number, code: string, safe: boolean, afterMs?: number) => ({
  status,
  body: {
    code: status, msg: code, requestId: 'req-sub', data: null,
    error: { code, details: [], execution: 'notStarted', retry: safe ? { safe, afterMs } : { safe } },
  },
});

describe('data.subscribe', () => {
  it('opens one GET event stream and yields changes with the declared alias, restricted ones as collection notices', async () => {
    const mock = sse([{ frames: [': connected\n\n', 'event: heartbeat\ndata: {}\n\n', change('e-1'), change('e-2', { collectionId: 'c-lines', change: 'delete', restricted: true })] }]);
    const events = await take(client(mock.fetch).subscribe(), 2);
    expect(events).toEqual([
      { type: 'change', eventId: 'e-1', collection: 'orders', collectionId: 'c-orders', recordId: 'o-1', revision: 2, change: 'record', occurredAt: 1000, restricted: false },
      { type: 'change', eventId: 'e-2', collection: 'lines', collectionId: 'c-lines', change: 'collection', occurredAt: 1000, restricted: true },
    ]);
    const [first] = mock.opened;
    expect(first.url.pathname).toBe(SUBSCRIBE);
    expect(first.url.searchParams.getAll('collectionIds')).toEqual(['c-orders', 'c-lines']);
    expect(first.headers.accept).toBe('text/event-stream');
    expect(first.headers['x-api-key']).toBe('sk-app');
    expect(first.headers['last-event-id']).toBeUndefined();
  });

  it('passes restricted changes in full only when asked for', async () => {
    const mock = sse([{ frames: [change('e-2', { restricted: true })] }]);
    expect(await take(client(mock.fetch).subscribe({ restricted: 'record' }), 1)).toEqual([
      { type: 'change', eventId: 'e-2', collection: 'orders', collectionId: 'c-orders', recordId: 'o-1', revision: 2, change: 'record', occurredAt: 1000, restricted: true },
    ]);
  });

  it('narrows to collections and records, and carries the subscribing request\'s data subject', async () => {
    const mock = sse([{ frames: [change('e-1')] }]);
    const headers = new Headers({ 'X-Tier0-App-Data-Subject': 'h.subject.s' });
    await runWithRequestContext(headers, () => take(client(mock.fetch).subscribe({ collections: ['orders'], recordIds: ['o-1', 'o-2'] }), 1));
    expect(mock.opened[0].url.searchParams.getAll('collectionIds')).toEqual(['c-orders']);
    expect(mock.opened[0].url.searchParams.getAll('recordIds')).toEqual(['o-1', 'o-2']);
    expect(mock.opened[0].headers['x-tier0-app-data-subject']).toBe('h.subject.s');
  });

  it('resumes after the last event or heartbeat position when a stream ends, and starts over after reset', async () => {
    const mock = sse([
      { frames: [change('e-1')] },
      { frames: ['id: e-3\nevent: heartbeat\ndata: {"at":1}\n\n'] },
      { frames: ['event: reset\ndata: {"reason":"CURSOR_EXPIRED","message":"too old"}\n\n'] },
      { frames: [change('e-9')] },
    ]);
    const events = await take(client(mock.fetch).subscribe({ lastEventId: 'e-0' }), 3);
    expect(events.map(event => (event.type === 'change' ? event.eventId : event))).toEqual([
      'e-1', { type: 'reset', reason: 'CURSOR_EXPIRED', message: 'too old' }, 'e-9',
    ]);
    expect(mock.opened.map(open => open.headers['last-event-id'])).toEqual(['e-0', 'e-1', 'e-3', undefined]);
  });

  it('drops non-delete changes at or below the revision already passed on for a record, and passes every delete', async () => {
    const mock = sse([
      {
        frames: [
          change('e-1', { revision: 3 }),
          change('e-2', { revision: 2 }), // written earlier, committed later
          change('e-3', { revision: 3 }),
          change('e-4', { recordId: 'o-2', revision: 1 }),
          change('e-5', { revision: 4 }),
          change('e-6', { revision: 4, change: 'delete' }),
          change('e-7', { revision: 1 }), // written again under the same ID
          change('e-8', { recordId: 'o-2', revision: 5 }),
          change('e-9', { recordId: 'o-2', revision: 3, change: 'delete' }), // a late delete
          change('e-10', { recordId: 'o-2', revision: 1 }),
        ],
      },
    ]);
    const events = await take(client(mock.fetch).subscribe(), 8);
    expect(events.map(event => (event.type === 'change' && event.change !== 'collection' ? [event.eventId, event.recordId, event.revision, event.change] : event))).toEqual([
      ['e-1', 'o-1', 3, 'record'],
      ['e-4', 'o-2', 1, 'record'],
      ['e-5', 'o-1', 4, 'record'],
      ['e-6', 'o-1', 4, 'delete'],
      ['e-7', 'o-1', 1, 'record'],
      ['e-8', 'o-2', 5, 'record'],
      ['e-9', 'o-2', 3, 'delete'],
      ['e-10', 'o-2', 1, 'record'],
    ]);
  });

  it('keeps the resume position of a dropped change and forgets revisions after reset', async () => {
    const mock = sse([
      { frames: [change('e-1', { revision: 3 }), change('e-2', { revision: 2 })] },
      { frames: ['event: reset\ndata: {"reason":"SCOPE_CHANGED"}\n\n'] },
      { frames: [change('e-9', { revision: 3 })] },
    ]);
    const events = await take(client(mock.fetch).subscribe(), 3);
    expect(events.map(event => (event.type === 'change' ? event.eventId : event))).toEqual(['e-1', { type: 'reset', reason: 'SCOPE_CHANGED' }, 'e-9']);
    expect(mock.opened.map(open => open.headers['last-event-id'])).toEqual([undefined, 'e-2', undefined]);
  });

  it('checks the contract limits and the resume position before connecting, and drops duplicate record IDs', async () => {
    const mock = sse([{ frames: [change('e-1')] }]);
    const data = client(mock.fetch);
    await expect(take(data.subscribe({ recordIds: ['o-1'] }), 1)).rejects.toThrow(/exactly one collection/);
    await expect(take(data.subscribe({ collections: [orders], recordIds: [] }), 1)).rejects.toThrow(/1–100 recordIds/);
    await expect(take(data.subscribe({ lastEventId: 'e-1\r\nX-Evil: 1' }), 1)).rejects.toThrow(/visible ASCII/);
    expect(mock.opened).toHaveLength(0);
    await take(data.subscribe({ collections: [orders, 'orders'], recordIds: ['o-1', 'o-1', 'o-2'] }), 1);
    expect(mock.opened[0].url.searchParams.getAll('collectionIds')).toEqual(['c-orders']);
    expect(mock.opened[0].url.searchParams.getAll('recordIds')).toEqual(['o-1', 'o-2']);
  });

  it('waits for an App that is not ready yet instead of ending', async () => {
    const notReady = { code: 503, msg: 'not ready', requestId: 'r', data: null, error: { code: 'APP_NOT_READY', reason: 'not ready', details: [], execution: 'notStarted', retry: { safe: true, afterMs: 0 } } };
    // ensure is resent twice by the call itself, so four refusals outlast one call.
    const mock = sse([{ frames: [change('e-1')] }], [notReady, notReady, notReady, notReady, ensured]);
    expect(await take(client(mock.fetch).subscribe(), 1)).toHaveLength(1);
  });

  it('pauses after a reset even when the server resets right away', async () => {
    const mock = sse([{ frames: ['event: reset\ndata: {"reason":"SCOPE_CHANGED"}\n\n'] }, { frames: [change('e-1')] }]);
    const started = Date.now();
    const events = await take(client(mock.fetch).subscribe(), 2);
    expect(events[0]).toEqual({ type: 'reset', reason: 'SCOPE_CHANGED' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });

  it('reconnects a silent stream after the idle timeout', async () => {
    const mock = sse([{ frames: [], hold: true }, { frames: [change('e-1')] }]);
    const events = await take(client(mock.fetch).subscribe({ idleTimeoutMs: 20 }), 1);
    expect(events).toHaveLength(1);
    expect(mock.opened).toHaveLength(2);
  });

  it('retries a refusal while retry.safe holds and ends with any other refusal', async () => {
    const busy = sse([refusal(429, 'OVERLOADED', true, 10), { frames: [change('e-1')] }]);
    expect(await take(client(busy.fetch).subscribe(), 1)).toHaveLength(1);
    expect(busy.opened).toHaveLength(2);

    const denied = sse([refusal(403, 'FORBIDDEN', false)]);
    const error = await take(client(denied.fetch).subscribe(), 1).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DataError);
    expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403, upstreamStatus: 403 });
    expect(denied.opened).toHaveLength(1);
  });

  it('re-ensures a collection that is gone and starts over on its new ID', async () => {
    const recreated = structuredClone(ensured);
    recreated.data.results[0] = { ...recreated.data.results[0], collectionId: 'c-orders-2', status: 'created' };
    const gone = refusal(403, 'FORBIDDEN', false);
    gone.body.data = { reason: 'COLLECTION_NOT_GRANTED' } as never;
    const mock = sse([gone, { frames: [change('e-5', { collectionId: 'c-orders-2' })] }], [ensured, recreated]);
    const events = await take(client(mock.fetch).subscribe({ collections: [orders], lastEventId: 'e-4' }), 2);
    expect(events[0]).toEqual({ type: 'reset', reason: 'COLLECTION_RECREATED' });
    expect(events[1]).toMatchObject({ collection: 'orders', collectionId: 'c-orders-2' });
    expect(mock.opened.map(open => [open.url.searchParams.getAll('collectionIds'), open.headers['last-event-id']])).toEqual([[['c-orders'], 'e-4'], [['c-orders-2'], undefined]]);
  });

  it('ends without error when aborted', async () => {
    const mock = sse([{ frames: [change('e-1')], hold: true }]);
    const controller = new AbortController();
    const seen: SubscriptionEvent[] = [];
    for await (const event of client(mock.fetch).subscribe({ signal: controller.signal })) {
      seen.push(event);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
    expect(mock.opened).toHaveLength(1);
  });

  it('redacts restricted changes to a collection-level notice', () => {
    const base = { type: 'change', eventId: 'e-1', collection: 'orders', collectionId: 'c-orders', occurredAt: 1, recordId: 'o-1', revision: 3, change: 'record' } as const;
    expect(redactRestricted({ ...base, restricted: false })).toEqual({ ...base, restricted: false });
    expect(redactRestricted({ ...base, restricted: true })).toEqual({
      type: 'change', eventId: 'e-1', collection: 'orders', collectionId: 'c-orders', occurredAt: 1, restricted: true, change: 'collection',
    });
    expect(redactRestricted({ type: 'reset' })).toEqual({ type: 'reset' });
  });
});
