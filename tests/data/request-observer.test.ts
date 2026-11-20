import { describe, expect, it, vi } from 'vitest';
import { createDataClient, type DataRequestObservation, type DataRequestObserver } from '../../src/data/index.js';
import { createDataTransport, MAX_CONCURRENT_CALLS } from '../../src/data/call.js';

const config = { apiHost: 'https://observer.invalid', apiKey: 'secret-fixture-key' };
const ok = (requestId = 'request-ok') => new Response(JSON.stringify({
  code: 200, msg: 'ok', requestId, data: { count: 3, capped: false },
}));
const fail = (requestId: string, code: string, safe = false, afterMs = 0) => new Response(JSON.stringify({
  code: 503, msg: 'sensitive error message', requestId, data: null,
  error: { code, reason: 'sensitive reason', execution: safe ? 'notStarted' : 'unknown', details: [], retry: { safe, afterMs } },
}), { status: 503 });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('optional data request observer', () => {
  it('reports the successful response ID and safe metadata without changing the high-level result', async () => {
    const events: Readonly<DataRequestObservation>[] = [];
    const data = createDataClient({ ...config, fetch: async () => ok(), onRequest: event => { events.push(event); } });
    const result = await data.collection({ collectionId: 'orders' }).countDocuments({ code: 'private-order-code' });
    expect(result).toEqual({ count: 3, capped: false });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'recordCount', collectionId: 'orders', requestId: 'request-ok', outcome: 'success', attempts: 1, retries: 0 });
    expect(events[0].queueMs).toBeGreaterThanOrEqual(0);
    expect(events[0].requestMs).toBeGreaterThanOrEqual(0);
    expect(events[0].durationMs).toBeGreaterThanOrEqual(events[0].queueMs + events[0].requestMs);
    expect(Object.isFrozen(events[0])).toBe(true);
    const serialized = JSON.stringify(events);
    for (const secret of ['secret-fixture-key', 'private-order-code', 'https://', 'headers', 'filter', 'count', 'capped']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('records retries once for the whole call and does not mistake backoff for request time', async () => {
    const events: Readonly<DataRequestObservation>[] = [];
    let sent = 0;
    const transport = createDataTransport({ ...config,
      fetch: async () => ++sent === 1 ? fail('request-busy', 'OVERLOADED', true, 30) : ok('request-final'),
      onRequest: event => { events.push(event); },
    });
    expect(await transport.call('recordCount', { collectionId: 'orders' })).toEqual({ count: 3, capped: false });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ requestId: 'request-final', outcome: 'success', attempts: 2, retries: 1 });
    expect(events[0].durationMs - events[0].requestMs - events[0].queueMs).toBeGreaterThanOrEqual(20);
  });

  it('reports a failed unknown write without replay or exposing its payload or idempotency key', async () => {
    const events: Readonly<DataRequestObservation>[] = [];
    const fetch = vi.fn(async () => fail('request-unknown', 'OUTCOME_UNKNOWN'));
    const transport = createDataTransport({ ...config, fetch, onRequest: event => { events.push(event); } });
    await expect(transport.call('recordInsertOne', {
      collectionId: 'orders', data: { name: 'private-name' }, idempotencyKey: 'private-key',
    })).rejects.toMatchObject({ requestId: 'request-unknown', code: 'OUTCOME_UNKNOWN', execution: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'error', errorCode: 'OUTCOME_UNKNOWN', requestId: 'request-unknown', attempts: 1, retries: 0 });
    expect(Object.keys(events[0]).sort()).toEqual([
      'attempts', 'collectionId', 'durationMs', 'errorCode', 'operation', 'outcome', 'queueMs', 'requestId', 'requestMs', 'retries',
    ]);
  });

  it('retains the latest available response ID when a later attempt receives no response', async () => {
    const onRequest = vi.fn<DataRequestObserver>();
    let sent = 0;
    const transport = createDataTransport({ ...config, onRequest, fetch: async () => {
      if (++sent === 1) return fail('request-before-disconnect', 'OVERLOADED', true);
      throw new TypeError('fetch failed');
    } });
    await expect(transport.call('recordInsertOne', { collectionId: 'orders', data: { code: 'A' } }))
      .rejects.toMatchObject({ execution: 'unknown', attempts: 2 });
    expect(onRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      requestId: 'request-before-disconnect', outcome: 'error', attempts: 2, retries: 1,
    }));
  });

  it.each(['throw', 'reject', 'pending'] as const)('isolates observer %s from a successful write', async mode => {
    const onRequest: DataRequestObserver = () => {
      if (mode === 'throw') throw new Error('observer failed');
      if (mode === 'reject') return Promise.reject(new Error('observer rejected'));
      return new Promise<void>(() => {});
    };
    const fetch = vi.fn(async () => ok());
    const transport = createDataTransport({ ...config, fetch, onRequest });
    expect(await transport.call('recordInsertOne', { collectionId: 'orders', data: { code: 'A' } })).toEqual({ count: 3, capped: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the original failure when its observer fails', async () => {
    const transport = createDataTransport({ ...config, fetch: async () => fail('original', 'OUTCOME_UNKNOWN'),
      onRequest: () => { throw new Error('observer failed'); },
    });
    await expect(transport.call('recordInsertOne', { collectionId: 'orders', data: {} }))
      .rejects.toMatchObject({ requestId: 'original', code: 'OUTCOME_UNKNOWN' });
  });

  it('does not count an oversized local refusal as an attempt', async () => {
    const onRequest = vi.fn<DataRequestObserver>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const transport = createDataTransport({ ...config, fetch, onRequest });
    await expect(transport.call('recordInsertOne', { collectionId: 'orders', data: { text: 'payload' } }, { maxBodyBytes: 1 }))
      .rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    expect(fetch).not.toHaveBeenCalled();
    expect(onRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: 'error', errorCode: 'REQUEST_TOO_LARGE', attempts: 0, retries: 0,
    }));
  });

  async function withFullGate(run: () => Promise<void>) {
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const full = new Promise<void>(resolve => { ready = resolve; });
    let active = 0;
    const transport = createDataTransport({ ...config, fetch: async () => {
      if (++active === MAX_CONCURRENT_CALLS) ready();
      await held;
      return ok();
    } });
    const calls = Array.from({ length: MAX_CONCURRENT_CALLS }, () => transport.call('recordCount', { collectionId: 'orders' }));
    await full;
    try { await run(); } finally { release(); await Promise.all(calls); }
  }

  it('measures local queue time and reports an aborted queued call with zero requests', async () => {
    await withFullGate(async () => {
      const onRequest = vi.fn<DataRequestObserver>();
      const fetch = vi.fn<typeof globalThis.fetch>();
      const controller = new AbortController();
      const transport = createDataTransport({ ...config, fetch, onRequest });
      const result = transport.call('recordCount', { collectionId: 'orders' }, { signal: controller.signal }).catch(error => error);
      await wait(25);
      controller.abort();
      expect(await result).toMatchObject({ code: 'DATA_ABORTED', attempts: 0 });
      expect(fetch).not.toHaveBeenCalled();
      expect(onRequest).toHaveBeenCalledTimes(1);
      const event = onRequest.mock.calls[0][0];
      expect(event).toMatchObject({ outcome: 'error', errorCode: 'DATA_ABORTED', attempts: 0, retries: 0, requestMs: 0 });
      expect(event.queueMs).toBeGreaterThanOrEqual(15);
      expect(event.requestId).toBeUndefined();
    });
  });

  it('separates queue waiting from the attempt after a slot becomes available', async () => {
    const onRequest = vi.fn<DataRequestObserver>();
    const fetch = vi.fn(async () => ok('after-queue'));
    const transport = createDataTransport({ ...config, fetch, onRequest });
    let result!: Promise<unknown>;
    await withFullGate(async () => {
      result = transport.call('recordCount', { collectionId: 'orders' });
      await wait(25);
      expect(fetch).not.toHaveBeenCalled();
      expect(onRequest).not.toHaveBeenCalled();
    });
    expect(await result).toEqual({ count: 3, capped: false });
    expect(onRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      requestId: 'after-queue', outcome: 'success', attempts: 1, retries: 0,
    }));
    expect(onRequest.mock.calls[0][0].queueMs).toBeGreaterThanOrEqual(15);
  });

  it('reports a queue deadline without sending or retrying', async () => {
    await withFullGate(async () => {
      const onRequest = vi.fn<DataRequestObserver>();
      const fetch = vi.fn<typeof globalThis.fetch>();
      const transport = createDataTransport({ ...config, fetch, onRequest, transportTimeoutMs: 30 });
      await expect(transport.call('recordCount', { collectionId: 'orders' })).rejects.toMatchObject({ code: 'DATA_OVERLOADED' });
      expect(fetch).not.toHaveBeenCalled();
      expect(onRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        outcome: 'error', errorCode: 'DATA_OVERLOADED', attempts: 0, retries: 0, requestMs: 0,
      }));
      expect(onRequest.mock.calls[0][0].queueMs).toBeGreaterThanOrEqual(20);
    });
  });
});
