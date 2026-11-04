import { afterEach, describe, expect, it, vi } from 'vitest';
import { client as defaultClient, createClient, StreamRequestError, StreamRequestResultUnknownError } from '../src/index.js';
import { configureClient, getClient, HttpClient } from '../src/openapi/client.js';
import { CloudTransport } from '../src/cloud-transport.js';

const deferred = () => {
  let resolve!: (key: string) => void;
  const promise = new Promise<string>(done => { resolve = done; });
  return { promise, resolve };
};
const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const envelope = { code: 200, msg: '', requestId: 'fixture', data: {} };
const result = { code: 'pump.start', contractVersion: 'v1', result: null, runID: 'run-1', status: 'completed', replayed: false };

afterEach(() => { configureClient({}); vi.useRealTimers(); });

describe('provider configuration snapshots', () => {
  it.each(['http', 'uns', 'stream'] as const)('keeps the default %s request on its original client during reconfiguration', async kind => {
    const pending = deferred();
    const fetchA = vi.fn<typeof fetch>(async () => reply(kind === 'stream' ? result : envelope));
    const fetchB = vi.fn<typeof fetch>(async () => reply(kind === 'stream' ? result : envelope));
    configureClient({ apiHost: 'https://a.invalid', fetch: fetchA, apiKeyProvider: () => pending.promise });
    const run = () => kind === 'http' ? defaultClient.system.whoami()
      : kind === 'uns' ? defaultClient.uns.recordFind({ collectionId: 'orders' })
        : defaultClient.streams.requests.use({ code: 'pump.start' }).invoke({});
    const first = run();
    configureClient({ apiHost: 'https://b.invalid', apiKey: 'key-b', fetch: fetchB });
    pending.resolve('key-a');
    await first;
    expect(fetchB).not.toHaveBeenCalled();
    expect(fetchA).toHaveBeenCalledOnce();
    const [url, init] = fetchA.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/a\.invalid\//);
    expect(new Headers(init?.headers).get('x-api-key')).toBe('key-a');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer key-a');
    await run();
    expect(fetchB).toHaveBeenCalledOnce();
    expect(String(fetchB.mock.calls[0][0])).toMatch(/^https:\/\/b\.invalid\//);
    expect(new Headers(fetchB.mock.calls[0][1]?.headers).get('x-api-key')).toBe('key-b');
  });

  it.each(['postText', 'sse', 'post'] as const)('freezes fetch and URL even when %s receives a dynamic proxy', async kind => {
    const pending = deferred();
    const fetchA = vi.fn<typeof fetch>(async () => reply({}));
    const fetchB = vi.fn<typeof fetch>(async () => reply({}));
    configureClient({ apiHost: 'https://a.invalid', fetch: fetchA, apiKeyProvider: () => pending.promise });
    const proxy = new Proxy(new HttpClient(), { get(_target, key) {
      const current = getClient();
      const value: unknown = Reflect.get(current, key);
      return typeof value === 'function' ? value.bind(current) : value;
    } });
    const transport = new CloudTransport(() => proxy);
    const first = kind === 'postText' ? transport.postText('/test', '{}')
      : kind === 'sse' ? transport.getEventStream('/test') : transport.post('/test', {});
    configureClient({ apiHost: 'https://b.invalid', apiKey: 'key-b', fetch: fetchB });
    pending.resolve('key-a');
    await first;
    expect(fetchB).not.toHaveBeenCalled();
    expect(fetchA).toHaveBeenCalledOnce();
    expect(String(fetchA.mock.calls[0][0])).toBe('https://a.invalid/test');
    expect(new Headers(fetchA.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer key-a');
  });
});

describe('StreamRequest pre-dispatch failures', () => {
  it.each(['reject', 'timeout'] as const)('reports provider %s as notStarted through the public API', async mode => {
    const pending = deferred();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const sdk = createClient({ apiHost: 'https://a.invalid', apiKey: 'fallback', fetch, transportTimeoutMs: 20,
      apiKeyProvider: mode === 'reject' ? async () => { throw new Error('provider-secret'); } : () => pending.promise });
    const error = await sdk.streams.requests.use({ code: 'pump.start' }).invoke({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamRequestError);
    expect(error).not.toBeInstanceOf(StreamRequestResultUnknownError);
    expect(error).toMatchObject({ execution: 'notStarted', outcomeUnknown: false, retryable: false,
      errorCode: mode === 'timeout' ? 'STREAM_REQUEST_TRANSPORT_TIMEOUT' : 'STREAM_REQUEST_TRANSPORT_ERROR' });
    expect(String(error)).not.toContain('provider-secret');
    pending.resolve('late-key');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks signal cancellation while awaiting credentials as notStarted', async () => {
    const pending = deferred();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const transport = new CloudTransport(() => new HttpClient({ apiHost: 'https://a.invalid', fetch, apiKeyProvider: () => pending.promise }));
    const controller = new AbortController();
    const request = transport.post('/test', {}, controller.signal).catch((e: unknown) => e);
    controller.abort();
    expect(await request).toMatchObject({ notStarted: true });
    pending.resolve('late-key');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a failure after fetch dispatch as outcome unknown', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('response lost'); });
    const sdk = createClient({ apiHost: 'https://a.invalid', fetch, apiKeyProvider: async () => 'key-a' });
    const error = await sdk.streams.requests.use({ code: 'pump.start' }).invoke({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamRequestResultUnknownError);
    expect(error).toMatchObject({ outcomeUnknown: true, retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not mark a signal abort after dispatch as notStarted', async () => {
    const started = deferred();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      started.resolve('started');
      return new Promise<Response>(() => undefined);
    });
    const transport = new CloudTransport(() => new HttpClient({ apiHost: 'https://a.invalid', fetch, apiKeyProvider: async () => 'key-a' }));
    const controller = new AbortController();
    const request = transport.post('/test', {}, controller.signal).catch((e: unknown) => e);
    await started.promise;
    controller.abort();
    expect(await request).toMatchObject({ notStarted: false });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
