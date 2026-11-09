import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createChangeRelay,
  createDataClient,
  defineCollection,
  runWithAbortSignal,
  type RecordChange,
  type SubscribeOptions,
  type SubscriptionEvent,
} from '../../src/data/index.js';
import type { SubscribeObserver } from '../../src/data/subscribe.js';
import { DataError } from '../../src/data/error.js';

// The fan-out of createChangeRelay: one upstream per process, per-browser
// filters, positions handed out only once the upstream can deliver what
// follows, resume across upstream failures and idle closes, and the
// unavailable signal. The upstream itself (data.subscribe) is tested in data-subscribe.

interface Open { options: SubscribeOptions; observer: SubscribeObserver; signal: AbortSignal }

/** Upstream whose events and observer calls the test drives; records every open. */
function fakeUpstream() {
  const opens: Open[] = [];
  let push: (item: SubscriptionEvent | Error | null) => void = () => {};
  const subscribe = (options: SubscribeOptions, observer: SubscribeObserver = {}): AsyncIterable<SubscriptionEvent> => {
    const signal = options.signal!;
    opens.push({ options: { ...options }, observer, signal });
    const queue: (SubscriptionEvent | Error | null)[] = [];
    let wake: (() => void) | undefined;
    push = (item) => {
      queue.push(item);
      wake?.();
    };
    signal.addEventListener('abort', () => push(null));
    return (async function* () {
      for (;;) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const item = queue.shift();
        if (item === null || item === undefined) return;
        if (item instanceof Error) throw item;
        // Like data.subscribe: a change moves the resume position before it is passed on.
        if (item.type === 'change') observer.position?.(item.eventId);
        yield item;
      }
    })();
  };
  const last = () => opens[opens.length - 1];
  return {
    data: { subscribe },
    opens,
    push: (item: SubscriptionEvent | Error | null) => push(item),
    /** The current connection streams, at UNS position `at`. */
    connect: (at = 'uns-0') => {
      last().observer.position?.(at);
      last().observer.connected?.();
    },
    retrying: (error: DataError) => last().observer.retrying?.(error),
  };
}

const AT = Date.UTC(2026, 9, 22);

function change(eventId: string, collection = 'orders', recordId = `r-${eventId}`): RecordChange {
  return { type: 'change', eventId, collection, collectionId: `c-${collection}`, recordId, revision: 1, change: 'record', occurredAt: AT };
}

const overloaded = () => new DataError({ message: 'too many open subscriptions', status: 429, code: 'OVERLOADED', retry: { safe: true, afterMs: 5000 } });

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

interface Frame {
  event?: string;
  id?: string;
  data?: Record<string, unknown>;
  comment?: boolean;
}

/** Reads SSE frames of a response; `lastId` follows every `id` field, id-only frames included, like EventSource. */
function frames(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let done = false;
  let lastId: string | undefined;
  const read = async () => {
    const result = await reader.read();
    if (result.done) done = true;
    else text += decoder.decode(result.value);
  };
  /** Every frame received within `ms`: dispatched events, id-only frames and comments. */
  const raw = async (ms = 20): Promise<Frame[]> => {
    const until = Date.now() + ms;
    while (!done && Date.now() < until) await Promise.race([read(), tick(ms)]);
    const blocks = text.split('\n\n');
    text = blocks.pop() ?? '';
    return blocks.map((block) => {
      if (block.startsWith(':')) return { comment: true };
      const fields = Object.fromEntries(
        block.split('\n').filter((line) => /^(event|id|data):/.test(line))
          .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]),
      );
      if (fields.id !== undefined) lastId = fields.id;
      return { ...(fields.event ? { event: fields.event } : {}), ...(fields.id !== undefined ? { id: fields.id } : {}), ...(fields.data ? { data: JSON.parse(fields.data) } : {}) };
    });
  };
  return {
    raw,
    /** Dispatched frames received within `ms`. */
    async take(ms = 20): Promise<Frame[]> {
      return (await raw(ms)).filter((frame) => frame.event);
    },
    get lastId() {
      return lastId;
    },
    get ended() {
      return done;
    },
  };
}

const quiet = { warn() {} };

/** A relay whose upstream already streams, with one browser connected. */
async function ready(options: Parameters<typeof createChangeRelay>[1] = {}) {
  const upstream = fakeUpstream();
  const relay = createChangeRelay(upstream.data, { logger: quiet, ...options });
  const first = frames(relay.stream());
  await tick();
  upstream.connect();
  await first.take();
  return { upstream, relay, first };
}

describe('createChangeRelay', () => {
  it('gives no position before the upstream streams, then resets the browsers that connected meanwhile', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    const browser = frames(relay.stream());
    await tick();
    expect(upstream.opens).toHaveLength(1);
    expect(relay.status).toBe('connecting');
    expect(await browser.raw()).toEqual([]);
    expect(browser.lastId).toBeUndefined();

    upstream.connect('uns-1');
    const [reset] = await browser.take();
    expect(reset).toMatchObject({ event: 'reset', data: { reason: 'upstream-started' } });
    expect(reset.id).toMatch(/^[0-9a-f]{8}\.0$/);
    expect(relay.status).toBe('ready');

    upstream.push(change('1'));
    expect((await browser.take()).map((frame) => frame.data?.recordId)).toEqual(['r-1']);
  });

  it('gives a browser connecting to a streaming upstream its position at once', async () => {
    const { relay } = await ready();
    const late = frames(relay.stream());
    const head = await late.raw();
    expect(head).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{8}\.0$/) }]);
  });

  it('fans one upstream out to every browser through its filter', async () => {
    const { upstream, relay } = await ready();
    const orders = frames(relay.stream({ filter: (c) => c.collection === 'orders' }));
    const one = frames(relay.stream({ filter: (c) => c.recordId === 'r-2' }));
    await tick();
    upstream.push(change('1'));
    upstream.push(change('2', 'lines'));
    const ordersFrames = await orders.take();
    const oneFrames = await one.take();
    expect(upstream.opens).toHaveLength(1);
    expect(ordersFrames.map((frame) => [frame.event, frame.data?.recordId])).toEqual([['change', 'r-1']]);
    expect(oneFrames.map((frame) => frame.data?.collection)).toEqual(['lines']);
    expect(ordersFrames[0].data?.eventId).toBe(ordersFrames[0].id);
    expect(Object.keys(ordersFrames[0].data!).sort()).toEqual(['change', 'collection', 'eventId', 'occurredAt', 'recordId', 'revision']);
    expect(relay.size).toBe(3);
  });

  it('passes the collections option to the upstream, and its observer', async () => {
    const upstream = fakeUpstream();
    createChangeRelay(upstream.data, { collections: ['orders'] }).stream();
    await tick();
    expect(Object.keys(upstream.opens[0].options).sort()).toEqual(['collections', 'signal']);
    expect(upstream.opens[0].options.collections).toEqual(['orders']);
    expect(typeof upstream.opens[0].observer.connected).toBe('function');
  });

  it('drops a change whose filter throws or does not return true', async () => {
    const { upstream, relay } = await ready();
    const browser = frames(relay.stream({
      filter: (c) => {
        if (c.recordId === 'r-1') throw new Error('no role');
        return (c.recordId === 'r-3') as boolean;
      },
    }));
    await tick();
    for (const id of ['1', '2', '3']) upstream.push(change(id));
    expect((await browser.take()).map((frame) => frame.data?.recordId)).toEqual(['r-3']);
  });

  it('numbers events itself and never hands upstream cursors to browsers', async () => {
    const { upstream, first } = await ready();
    upstream.push(change('upstream-cursor-secret', 'orders', 'r-1'));
    const [received] = await first.take();
    expect(String(received.id)).toMatch(/^[0-9a-f]{8}\.1$/);
    expect(JSON.stringify(received).includes('upstream-cursor-secret')).toBe(false);
  });

  it('resumes a reconnecting browser from the buffer of the current epoch, through its filter', async () => {
    const { upstream, relay, first } = await ready();
    for (const id of ['1', '2', '3']) upstream.push(change(id));
    const [one] = await first.take();
    const resumed = await frames(relay.stream({ lastEventId: one.id })).take();
    expect(resumed.map((frame) => frame.data?.recordId)).toEqual(['r-2', 'r-3']);
    const filtered = await frames(relay.stream({ lastEventId: one.id, filter: (c) => c.recordId === 'r-3' })).take();
    expect(filtered.map((frame) => frame.data?.recordId)).toEqual(['r-3']);
    expect(await frames(relay.stream({ lastEventId: first.lastId })).take()).toEqual([]);
  });

  it('answers a forged or stale Last-Event-ID with a reset for that browser only and never opens the upstream from it', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    // Cold start: the first browser brings an ID the relay never issued.
    const forged = frames(relay.stream({ lastEventId: 'garbage' }));
    const other = frames(relay.stream());
    await tick();
    upstream.connect();
    expect((await forged.take()).map((frame) => frame.data?.reason)).toEqual(['unknown-event-id']);
    expect((await other.take()).map((frame) => frame.data?.reason)).toEqual(['upstream-started']);
    expect(upstream.opens).toHaveLength(1);
    expect(Object.keys(upstream.opens[0].options)).toEqual(['signal']);

    // The upstream works for everyone, the forging browser included.
    upstream.push(change('1'));
    expect(await forged.take()).toHaveLength(1);
    expect(await other.take()).toHaveLength(1);
    for (const lastEventId of ['deadbeef.0', '', null, `${String(forged.lastId).split('.')[0]}.99`]) {
      const answer = await frames(relay.stream({ lastEventId })).take();
      expect(answer.map((frame) => frame.event)).toEqual(lastEventId ? ['reset'] : []);
    }
    expect(upstream.opens).toHaveLength(1);
  });

  it('moves an idle browser\'s position with id-only heartbeats, and sends comments while it has none', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data, { heartbeatMs: 10 });
    const browser = frames(relay.stream());
    expect((await browser.raw(35)).every((frame) => frame.comment)).toBe(true);
    upstream.connect();
    await browser.raw(15);
    const other = frames(relay.stream({ filter: () => false }));
    await other.raw(15);
    for (const id of ['1', '2']) upstream.push(change(id));
    await tick(30);
    expect((await other.raw()).filter((frame) => frame.event)).toEqual([]);
    expect(other.lastId).toMatch(/\.2$/);
  });

  it('turns an upstream reset into a new epoch, and resets the browsers once the upstream streams again', async () => {
    const { upstream, relay, first } = await ready();
    upstream.push(change('1'));
    const [seen] = await first.take();
    upstream.push({ type: 'reset', reason: 'CURSOR_EXPIRED' });
    expect(await first.take()).toEqual([]);
    upstream.connect('uns-fresh');
    const [reset] = await first.take();
    expect(reset).toMatchObject({ event: 'reset', data: { reason: 'CURSOR_EXPIRED' } });
    expect(reset.id?.split('.')[0]).not.toBe(seen.id?.split('.')[0]);
    const stale = await frames(relay.stream({ lastEventId: seen.id })).take();
    expect(stale.map((frame) => frame.event)).toEqual(['reset']);
  });

  it('reopens a failed upstream from the last UNS position in the same epoch, without resetting browsers', async () => {
    const { upstream, relay, first } = await ready({ restartIntervalMs: 0 });
    upstream.push(change('7'));
    const [seven] = await first.take();
    upstream.push(new Error('stream refused'));
    const failure = await first.take();
    expect(failure).toEqual([{ event: 'unavailable', data: { reason: 'upstream-failed' } }]);
    expect(first.ended).toBe(false);
    expect(upstream.opens).toHaveLength(2);
    expect(upstream.opens[1].options.lastEventId).toBe('7');

    // What UNS delivered after the position comes through on the new connection, numbered on.
    upstream.connect('7');
    upstream.push(change('8'));
    const [eight] = await first.take();
    expect(eight.data?.recordId).toBe('r-8');
    expect(eight.id?.split('.')[0]).toBe(seven.id?.split('.')[0]);
    expect(eight.id?.split('.')[1]).toBe('2');
    expect(relay.status).toBe('ready');
    const resumed = await frames(relay.stream({ lastEventId: seven.id })).take();
    expect(resumed.map((frame) => frame.data?.recordId)).toEqual(['r-8']);
  });

  it('backs off between reopens of an upstream that keeps failing', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data, { restartIntervalMs: 30, logger: quiet });
    relay.stream();
    await tick();
    upstream.push(new Error('refused'));
    await tick(15);
    expect(upstream.opens).toHaveLength(1);
    await tick(30);
    expect(upstream.opens).toHaveLength(2);
    upstream.push(new Error('refused'));
    await tick(40);
    expect(upstream.opens).toHaveLength(2);
    await tick(40);
    expect(upstream.opens).toHaveLength(3);
  });

  it('closes the upstream after idleCloseMs and resumes in the same epoch when a browser comes back', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data, { idleCloseMs: 10 });
    const controller = new AbortController();
    const browser = frames(relay.stream({ signal: controller.signal }));
    await tick();
    upstream.connect();
    await browser.take();
    upstream.push(change('1'));
    const [seen] = await browser.take();
    controller.abort();
    expect(relay.size).toBe(0);
    expect(upstream.opens[0].signal.aborted).toBe(false);
    await tick(30);
    expect(upstream.opens[0].signal.aborted).toBe(true);
    expect(relay.status).toBe('idle');

    // Back from a hidden tab: no reset, and what changed meanwhile arrives from the reopened upstream.
    const back = frames(relay.stream({ lastEventId: seen.id }));
    await tick();
    expect(upstream.opens).toHaveLength(2);
    expect(upstream.opens[1].options.lastEventId).toBe('1');
    upstream.connect('1');
    upstream.push(change('2'));
    const later = await back.take();
    expect(later.map((frame) => [frame.event, frame.data?.recordId])).toEqual([['change', 'r-2']]);
    expect(later[0].id?.split('.')[0]).toBe(seen.id?.split('.')[0]);
  });

  it('signals an upstream over the subscription limit to onStatus, the log and every browser', async () => {
    const upstream = fakeUpstream();
    const onStatus = vi.fn();
    const warn = vi.fn();
    const relay = createChangeRelay(upstream.data, { onStatus, logger: { warn } });
    const browser = frames(relay.stream());
    await tick();
    upstream.retrying(overloaded());
    upstream.retrying(overloaded());
    expect(await browser.take()).toEqual([{ event: 'unavailable', data: { reason: 'OVERLOADED' } }]);
    expect(relay.status).toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual(['connecting', 'unavailable']);
    expect(onStatus.mock.calls[1][1]).toBeInstanceOf(DataError);
    // A browser arriving now hears it too, and still waits for a position.
    const late = frames(relay.stream());
    expect(await late.raw()).toEqual([{ event: 'unavailable', data: { reason: 'OVERLOADED' } }]);

    upstream.connect();
    expect((await browser.take()).map((frame) => frame.data?.reason)).toEqual(['upstream-started']);
    expect((await late.take()).map((frame) => frame.data?.reason)).toEqual(['upstream-started']);
    expect(relay.status).toBe('ready');
  });

  it('ends every browser stream after maxStreamMs so the route authenticates the reconnect', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data, { maxStreamMs: 20 });
    const browser = frames(relay.stream());
    await browser.take(60);
    expect(browser.ended).toBe(true);
    expect(relay.size).toBe(0);
  });

  it('answers an already aborted request with an empty stream', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    const controller = new AbortController();
    controller.abort();
    const browser = frames(relay.stream({ signal: controller.signal }));
    expect(await browser.take()).toEqual([]);
    expect(browser.ended).toBe(true);
    expect(upstream.opens).toHaveLength(0);
  });
});

describe('createChangeRelay over data.subscribe', () => {
  const cases = defineCollection({ alias: 'cases', name: 'Cases', schema: z.object({ title: z.string() }) });
  const ensured = () => Response.json({
    code: 200, msg: 'ok', requestId: 'req-1',
    data: { appId: 'app-1', results: [{ alias: 'cases', collectionId: 'c-cases', revision: 1, status: 'unchanged', ignored: [], warnings: [], indexStatus: [] }] },
  });
  const frame = (eventId: string, extra: Record<string, unknown> = {}) =>
    `id: ${eventId}\nevent: change\ndata: ${JSON.stringify({ eventId, collectionId: 'c-cases', recordId: 'k-1', revision: 2, change: 'record', occurredAt: AT, ...extra })}\n\n`;
  const client = (fetch: typeof globalThis.fetch) => createDataClient({
    collections: [cases], fetch, apiHost: 'http://gw.local', apiKey: 'sk-app', logger: { info() {}, warn() {}, error() {} },
  });

  it('opens the upstream as the App, resets browsers once it streams, outlives the first request and never forwards a browser\'s Last-Event-ID', async () => {
    const opened: Record<string, string>[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/uns/app/collections/ensure')) return ensured();
      opened.push(Object.fromEntries(new Headers(init?.headers).entries()));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('id: p-0\nevent: heartbeat\ndata: {}\n\n' + frame('p-1') + frame('p-2', { recordId: 'k-2' })));
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof globalThis.fetch;
    const relay = createChangeRelay(client(fetch), { idleCloseMs: 0 });
    const request = new AbortController();
    const browserGone = new AbortController();

    const browser = frames(runWithAbortSignal(request.signal, () =>
      relay.stream({ lastEventId: 'garbage', signal: browserGone.signal, filter: (c) => c.recordId === 'k-2' })));
    // The request that opened the upstream is over; the upstream keeps serving.
    request.abort();
    const received = await browser.take(100);
    browserGone.abort();

    expect(opened).toHaveLength(1);
    expect(opened[0]['x-api-key']).toBe('sk-app');
    expect(opened[0].accept).toBe('text/event-stream');
    expect(opened[0]['last-event-id']).toBeUndefined();
    expect(received.map((item) => [item.event, item.data?.recordId ?? item.data?.reason])).toEqual([
      ['reset', 'unknown-event-id'],
      ['change', 'k-2'],
    ]);
  });

  it('reopens from the last UNS position after data.subscribe ends with a failure', async () => {
    const opened: (string | null)[] = [];
    let connections = 0;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/uns/app/collections/ensure')) return ensured();
      opened.push(new Headers(init?.headers).get('last-event-id'));
      connections += 1;
      if (connections === 2) {
        return Response.json({ code: 403, msg: 'FORBIDDEN', requestId: 'r', data: null, error: { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } } }, { status: 403 });
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const text = connections === 1 ? 'id: p-0\nevent: heartbeat\ndata: {}\n\n' + frame('p-1') : 'id: p-1\nevent: heartbeat\ndata: {}\n\n' + frame('p-2', { recordId: 'k-2' });
          controller.enqueue(new TextEncoder().encode(text));
          // The first connection ends at once: data.subscribe reconnects and is refused.
          if (connections === 1) controller.close();
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof globalThis.fetch;
    const relay = createChangeRelay(client(fetch), { idleCloseMs: 0, restartIntervalMs: 0, logger: quiet });
    const controller = new AbortController();
    const browser = frames(relay.stream({ signal: controller.signal }));
    const received = await browser.take(2500);
    controller.abort();

    expect(opened).toEqual([null, 'p-1', 'p-1']);
    expect(received.map((item) => [item.event, item.data?.recordId ?? item.data?.reason])).toEqual([
      ['reset', 'upstream-started'],
      ['change', 'k-1'],
      ['unavailable', 'FORBIDDEN'],
      ['change', 'k-2'],
    ]);
  });
});
