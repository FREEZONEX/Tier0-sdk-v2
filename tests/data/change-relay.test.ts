import { describe, expect, it } from 'vitest';
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

// The fan-out of createChangeRelay: one upstream per process, per-browser
// filters, the relay's own positions, Last-Event-ID resume and the upstream
// lifecycle. The upstream itself (data.subscribe) is tested in data-subscribe.

/** Upstream whose events the test pushes; records every open. */
function fakeUpstream() {
  const opens: { options: SubscribeOptions; signal: AbortSignal }[] = [];
  let push: (item: SubscriptionEvent | Error | null) => void = () => {};
  const subscribe = (options: SubscribeOptions): AsyncIterable<SubscriptionEvent> => {
    const signal = options.signal!;
    opens.push({ options: { ...options }, signal });
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
        yield item;
      }
    })();
  };
  return { data: { subscribe }, opens, push: (item: SubscriptionEvent | Error | null) => push(item) };
}

const AT = Date.UTC(2026, 9, 22);

function change(eventId: string, collection = 'orders', recordId = `r-${eventId}`): RecordChange {
  return { type: 'change', eventId, collection, collectionId: `c-${collection}`, recordId, revision: 1, change: 'record', occurredAt: AT };
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

interface Frame {
  event: string;
  id?: string;
  data: Record<string, unknown>;
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
  return {
    /** Dispatched frames received within `ms`. */
    async take(ms = 20): Promise<Frame[]> {
      const until = Date.now() + ms;
      while (!done && Date.now() < until) await Promise.race([read(), tick(ms)]);
      const blocks = text.split('\n\n');
      text = blocks.pop() ?? '';
      const out: Frame[] = [];
      for (const block of blocks) {
        const fields = Object.fromEntries(
          block
            .split('\n')
            .filter((line) => /^(event|id|data):/.test(line))
            .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]),
        );
        if (fields.id !== undefined) lastId = fields.id;
        if (fields.event) out.push({ event: fields.event, id: fields.id, data: JSON.parse(fields.data) });
      }
      return out;
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

describe('createChangeRelay', () => {
  it('fans one upstream out to every browser through its filter', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    const orders = frames(relay.stream({ filter: (c) => c.collection === 'orders' }));
    const one = frames(relay.stream({ filter: (c) => c.recordId === 'r-2' }));
    await tick();

    upstream.push(change('1'));
    upstream.push(change('2', 'lines'));
    const ordersFrames = await orders.take();
    const oneFrames = await one.take();

    expect(upstream.opens).toHaveLength(1);
    expect(ordersFrames.map((frame) => [frame.event, frame.data.recordId])).toEqual([['change', 'r-1']]);
    expect(oneFrames.map((frame) => frame.data.collection)).toEqual(['lines']);
    expect(ordersFrames[0].data.eventId).toBe(ordersFrames[0].id);
    expect(Object.keys(ordersFrames[0].data).sort()).toEqual(['change', 'collection', 'eventId', 'occurredAt', 'recordId', 'revision']);
    expect(relay.size).toBe(2);
  });

  it('passes the collections option to the upstream', async () => {
    const upstream = fakeUpstream();
    createChangeRelay(upstream.data, { collections: ['orders'] }).stream();
    await tick();
    expect(Object.keys(upstream.opens[0].options).sort()).toEqual(['collections', 'signal']);
    expect(upstream.opens[0].options.collections).toEqual(['orders']);
  });

  it('drops a change whose filter throws or does not return true', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data, { logger: quiet });
    const browser = frames(relay.stream({
      filter: (c) => {
        if (c.recordId === 'r-1') throw new Error('no role');
        return (c.recordId === 'r-3') as boolean;
      },
    }));
    await tick();
    for (const id of ['1', '2', '3']) upstream.push(change(id));
    expect((await browser.take()).map((frame) => frame.data.recordId)).toEqual(['r-3']);
  });

  it('numbers events itself and never hands upstream cursors to browsers', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    const browser = frames(relay.stream());
    await tick();
    upstream.push(change('upstream-cursor-secret', 'orders', 'r-1'));
    const [received] = await browser.take();
    expect(String(received.id)).toMatch(/^[0-9a-f]{8}\.1$/);
    expect(JSON.stringify(received).includes('upstream-cursor-secret')).toBe(false);
  });

  it('resumes a reconnecting browser from the buffer of the current session, through its filter', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    const first = frames(relay.stream());
    await tick();
    for (const id of ['1', '2', '3']) upstream.push(change(id));
    const [one] = await first.take();

    const resumed = await frames(relay.stream({ lastEventId: one.id })).take();
    expect(resumed.map((frame) => frame.data.recordId)).toEqual(['r-2', 'r-3']);
    const filtered = await frames(relay.stream({ lastEventId: one.id, filter: (c) => c.recordId === 'r-3' })).take();
    expect(filtered.map((frame) => frame.data.recordId)).toEqual(['r-3']);
    expect(await frames(relay.stream({ lastEventId: first.lastId })).take()).toEqual([]);
  });

  it('answers a forged or stale Last-Event-ID with a reset for that browser only and never opens the upstream from it', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    // Cold start: the first browser brings an ID the relay never issued.
    const forged = frames(relay.stream({ lastEventId: 'garbage' }));
    const other = frames(relay.stream());
    await tick();

    expect((await forged.take()).map((frame) => frame.event)).toEqual(['reset']);
    expect(await other.take()).toEqual([]);
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

  it('gives every browser a resume point on connect, so one that saw no event yet still catches up', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    const keepAlive = frames(relay.stream());
    const controller = new AbortController();
    const quietBrowser = frames(relay.stream({ signal: controller.signal }));
    await quietBrowser.take();
    const resumeAt = quietBrowser.lastId;
    expect(resumeAt).toBeTruthy();
    controller.abort();

    upstream.push(change('1'));
    await keepAlive.take();
    const resumed = await frames(relay.stream({ lastEventId: resumeAt })).take();
    expect(resumed.map((frame) => frame.data.recordId)).toEqual(['r-1']);
  });

  it('turns an upstream reset into a new session', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data);
    const browser = frames(relay.stream({ filter: (c) => c.recordId === 'r-1' }));
    await tick();
    upstream.push(change('1'));
    upstream.push({ type: 'reset', reason: 'CURSOR_EXPIRED' });
    const received = await browser.take();
    expect(received.map((frame) => frame.event)).toEqual(['change', 'reset']);
    expect(received[1].data).toEqual({ reason: 'CURSOR_EXPIRED' });
    expect(received[1].id?.split('.')[0]).not.toBe(received[0].id?.split('.')[0]);
    const stale = await frames(relay.stream({ lastEventId: received[0].id })).take();
    expect(stale.map((frame) => frame.event)).toEqual(['reset']);
  });

  it('keeps browsers connected through an upstream failure: reset, new session, reopened upstream', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data, { restartIntervalMs: 0, logger: quiet });
    const browser = frames(relay.stream());
    await tick();
    upstream.push(change('7'));
    upstream.push(new Error('cursor rejected'));
    const received = await browser.take();
    expect(received.map((frame) => frame.event)).toEqual(['change', 'reset']);
    expect(received[1].data.reason).toBe('upstream-failed');
    expect(browser.ended).toBe(false);
    expect(upstream.opens).toHaveLength(2);
    expect(Object.keys(upstream.opens[1].options)).toEqual(['signal']);

    upstream.push(change('8'));
    expect((await browser.take()).map((frame) => frame.data.recordId)).toEqual(['r-8']);
    const stale = await frames(relay.stream({ lastEventId: received[0].id })).take();
    expect(stale.map((frame) => frame.event)).toEqual(['reset']);
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

  it('closes the upstream and forgets the session once the last browser has been gone for idleCloseMs', async () => {
    const upstream = fakeUpstream();
    const relay = createChangeRelay(upstream.data, { idleCloseMs: 10 });
    const controller = new AbortController();
    const browser = frames(relay.stream({ signal: controller.signal }));
    await tick();
    upstream.push(change('1'));
    const [seen] = await browser.take();
    controller.abort();
    expect(relay.size).toBe(0);
    expect(upstream.opens[0].signal.aborted).toBe(false);
    await tick(30);
    expect(upstream.opens[0].signal.aborted).toBe(true);

    // Later: the old position is not replayed from; the browser reloads.
    const later = await frames(relay.stream({ lastEventId: seen.id })).take();
    expect(later.map((frame) => frame.event)).toEqual(['reset']);
    expect(upstream.opens).toHaveLength(2);
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
  it('opens the upstream from now as the App, outlives the request that connected first and never forwards its Last-Event-ID', async () => {
    const opened: Record<string, string>[] = [];
    const frame = (eventId: string, extra: Record<string, unknown> = {}) =>
      `id: ${eventId}\nevent: change\ndata: ${JSON.stringify({ eventId, collectionId: 'c-cases', recordId: 'k-1', revision: 2, change: 'record', occurredAt: AT, ...extra })}\n\n`;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/uns/app/collections/ensure')) {
        return Response.json({
          code: 200, msg: 'ok', requestId: 'req-1',
          data: { appId: 'app-1', results: [{ alias: 'cases', collectionId: 'c-cases', revision: 1, status: 'unchanged', ignored: [], warnings: [], indexStatus: [] }] },
        });
      }
      opened.push(Object.fromEntries(new Headers(init?.headers).entries()));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame('1') + frame('2', { recordId: 'k-2' })));
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    }) as typeof globalThis.fetch;
    const cases = defineCollection({ alias: 'cases', name: 'Cases', schema: z.object({ title: z.string() }) });
    const data = createDataClient({
      collections: [cases], fetch, apiHost: 'http://gw.local', apiKey: 'sk-app', logger: { info() {}, warn() {}, error() {} },
    });
    const relay = createChangeRelay(data, { idleCloseMs: 0 });
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
    expect(received.map((frame) => [frame.event, frame.data.recordId])).toEqual([
      ['reset', undefined],
      ['change', 'k-2'],
    ]);
  });
});
