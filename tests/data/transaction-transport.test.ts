import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataTransport, DEFAULT_DATA_TIMEOUT_MS, DEFAULT_TRANSACTION_TIMEOUT_MS } from '../../src/data/call.js';
import { HttpClient } from '../../src/openapi/client.js';
import { UnsV2ClientCore } from '../../src/uns-v2/client.js';

afterEach(() => vi.useRealTimers());

describe('record transaction transport budget', () => {
  function fixture(transportTimeoutMs?: number) {
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const transport = createDataTransport({ apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch, transportTimeoutMs });
    return { ...transport, fetch };
  }

  it('refuses an oversized body without sending or retrying and releases its deadline', async () => {
    vi.useFakeTimers();
    const transport = fixture();
    const body = { items: [], idempotencyKey: '设备🙂' };
    const requestedBytes = Buffer.byteLength(JSON.stringify(body));
    await expect(transport.call('recordTransactionExecute', body, { maxBodyBytes: requestedBytes - 1 })).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE', status: 413, execution: 'notStarted', attempts: 0, upstreamStatus: 0,
      details: { requestedBytes, maxBodyBytes: requestedBytes - 1 },
    });
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid transport size limit: %s', async maxRequestBytes => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const http = new HttpClient({ apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch });
    const core = new UnsV2ClientCore(() => http);
    await expect(core.call('catalog', {}, { maxRequestBytes })).rejects.toThrow('positive safe integer');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { operation: 'recordTransactionExecute' as const, maxBodyBytes: undefined, ceiling: 32 << 20 },
    { operation: 'recordTransactionExecute' as const, maxBodyBytes: 64 << 20, ceiling: 32 << 20 },
    { operation: 'recordInsertOne' as const, maxBodyBytes: undefined, ceiling: 16 << 20 },
  ])('maps the client ceiling to a local DataError for $operation with advertised limit $maxBodyBytes', async ({ operation, maxBodyBytes, ceiling }) => {
    vi.useFakeTimers();
    const transport = fixture(), data = { value: 'x'.repeat(ceiling) };
    const body = operation === 'recordTransactionExecute'
      ? { items: [{ opId: 'one', action: 'record.create', collectionId: 'records', data }] }
      : { collectionId: 'records', data };
    await expect(transport.call(operation, body, { maxBodyBytes })).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE', status: 413, execution: 'notStarted', attempts: 0, outcomeUnknown: false,
      details: { maxBodyBytes: ceiling },
    });
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never lets an advertised limit raise the ordinary wire ceiling', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const http = new HttpClient({ apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch });
    const core = new UnsV2ClientCore(() => http);
    await expect(core.call('recordInsertOne', { collectionId: 'records', data: { value: 'x'.repeat(16 << 20) } },
      { maxRequestBytes: 32 << 20 })).rejects.toThrow('16777216-byte contract limit');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows a transaction past the ordinary deadline, then reports unknown without replay', async () => {
    vi.useFakeTimers();
    const transport = fixture();
    let finished = false;
    const result = transport.call('recordTransactionExecute', { items: [] }).catch(error => { finished = true; return error; });
    await vi.advanceTimersByTimeAsync(DEFAULT_DATA_TIMEOUT_MS + 1);
    expect(finished).toBe(false);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_TRANSACTION_TIMEOUT_MS - DEFAULT_DATA_TIMEOUT_MS);
    expect(await result).toMatchObject({ execution: 'unknown', attempts: 1, code: 'DATA_TIMEOUT' });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the ordinary deadline', async () => {
    vi.useFakeTimers();
    const transport = fixture();
    const result = transport.call('catalog', {}).catch(error => error);
    await vi.advanceTimersByTimeAsync(DEFAULT_DATA_TIMEOUT_MS);
    expect(await result).toMatchObject({ code: 'DATA_TIMEOUT', attempts: 1 });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors an explicit shorter deadline for transactions', async () => {
    vi.useFakeTimers();
    const transport = fixture(100);
    const result = transport.call('recordTransactionExecute', { items: [] }).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ execution: 'unknown', code: 'DATA_TIMEOUT', attempts: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still aborts a long transaction on caller cancellation', async () => {
    vi.useFakeTimers();
    const transport = fixture(), controller = new AbortController();
    const result = transport.call('recordTransactionExecute', { items: [] }, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(DEFAULT_DATA_TIMEOUT_MS + 1);
    controller.abort();
    expect(await result).toMatchObject({ execution: 'unknown', code: 'DATA_ABORTED', attempts: 1 });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
