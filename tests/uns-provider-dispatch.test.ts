import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/index.js';
import { UnsV2Error, UnsV2OutcomeUnknownError } from '../src/uns-v2/client.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('UNS writes with asynchronous credentials', () => {
  it.each(['timeout', 'abort', 'reject'] as const)('reports %s before dispatch as notStarted', async mode => {
    const pending = deferred<string>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    const sdk = createClient({ apiHost: 'https://fixture.invalid', apiKey: 'unused-static', fetch, transportTimeoutMs: 30,
      apiKeyProvider: mode === 'reject' ? async () => { throw new Error('sensitive-provider-error'); } : () => pending.promise });
    const call = sdk.uns.recordInsertOne({ collectionId: 'orders', data: {}, idempotencyKey: 'original-intent' }, { signal: controller.signal });
    const result = call.catch((error: unknown) => error);
    if (mode === 'abort') controller.abort();
    const error = await result;
    expect(error).toBeInstanceOf(UnsV2Error);
    expect(error).not.toBeInstanceOf(UnsV2OutcomeUnknownError);
    expect(error).toMatchObject({ execution: 'notStarted', outcomeUnknown: false, retry: { safe: false },
      code: mode === 'timeout' ? 'UNS_V2_TRANSPORT_TIMEOUT' : mode === 'abort' ? 'UNS_V2_TRANSPORT_ABORTED' : 'UNS_V2_TRANSPORT_ERROR' });
    expect(String(error)).not.toContain('sensitive-provider-error');
    pending.resolve('late-key');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'abort', 'network'] as const)('keeps %s after dispatch unknown', async mode => {
    const started = deferred<void>();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      started.resolve();
      if (mode === 'network') throw new Error('response lost');
      return new Promise<Response>(() => undefined);
    });
    const controller = new AbortController();
    const sdk = createClient({ apiHost: 'https://fixture.invalid', fetch, transportTimeoutMs: 30, apiKeyProvider: async () => 'fixture-key' });
    const call = sdk.uns.recordInsertOne({ collectionId: 'orders', data: {}, idempotencyKey: 'original-intent' }, { signal: controller.signal });
    const result = call.catch((error: unknown) => error);
    await started.promise;
    if (mode === 'abort') controller.abort();
    const error = await result;
    expect(error).toBeInstanceOf(UnsV2OutcomeUnknownError);
    expect(error).toMatchObject({ execution: 'unknown', outcomeUnknown: true, retry: { safe: false },
      code: mode === 'timeout' ? 'UNS_V2_TRANSPORT_TIMEOUT' : mode === 'abort' ? 'UNS_V2_TRANSPORT_ABORTED' : 'UNS_V2_TRANSPORT_ERROR' });
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.idempotencyKey).toBe('original-intent');
  });
});
