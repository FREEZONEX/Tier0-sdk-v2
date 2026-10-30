import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, createClient } from '../src/client.js';
import * as sdk from '../src/index.js';
import { getAppRuntime, installAppRuntime } from '../src/runtime.js';
import { configureClient } from '../src/openapi/client.js';

const contract = {
  code: 'pump.start', name: 'Start', description: '', contractVersion: 'v1',
  inputSchema: {}, outputSchema: {}, sideEffect: 'write', idempotency: 'required', timeoutMs: 1000, status: 'active',
};
const installed: (() => void)[] = [];
afterEach(() => { while (installed.length) installed.pop()!(); configureClient({}); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('App runtime injection', () => {
  it('automatically supplies requests without host or credentials, including an already-created client', async () => {
    vi.stubGlobal('window', {});
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const isolated = createClient();
    const request = vi.fn(async () => Response.json(contract));
    installed.push(installAppRuntime({ appId: 'trusted-app-id', request }));
    expect(await client.streams.requests.use({ code: 'pump.start' }).describe()).toEqual(contract);
    expect(await isolated.streams.requests.use({ code: 'pump.start' }).describe()).toEqual(contract);
    expect(request).toHaveBeenCalledWith('/openapi/v2/stream-requests/pump.start/describe', {}, { signal: expect.any(AbortSignal) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed for a browser missing its trusted runtime', async () => {
    vi.stubGlobal('window', {}); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createClient({ apiHost: 'https://example', apiKey: 'server-secret' }).streams.requests.use({ code: 'pump.start' }).describe())
      .rejects.toMatchObject({ errorCode: 'STREAM_REQUEST_TRANSPORT_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds an unresponsive bridge without retrying invocation', async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => new Promise<Response>(() => {}));
    installed.push(installAppRuntime({ appId: 'trusted-app-id', request }));
    const result = createClient({ transportTimeoutMs: 10 }).streams.requests.use({ code: 'pump.start' }).invoke({}).catch(error => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toMatchObject({ errorCode: 'STREAM_REQUEST_TRANSPORT_TIMEOUT', outcomeUnknown: true, retryable: false });
    expect(request).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not expose retired control exports or runtime aliases', () => {
    expect(Object.keys(sdk).filter(key => /control/i.test(key))).toEqual([]);
    expect(Object.keys(client)).toEqual(['streams', 'dispose', 'system', 'members', 'notifications', 'mqttAuth', 'agent', 'files', 'capabilities', 'source', 'stream', 'uns', 'api']);
    expect(getAppRuntime()).toBeUndefined();
  });

  it('resolves the configured default transport without changing isolated clients', async () => {
    const isolatedFetch = vi.fn(async () => Response.json(contract));
    const isolated = createClient({ apiHost: 'https://isolated.example', fetch: isolatedFetch });
    const currentFetch = vi.fn(async (url: RequestInfo | URL) => Response.json(String(url).endsWith('/info') ? { code: 200, data: {} } : contract));
    configureClient({ apiHost: 'https://configured.example', fetch: currentFetch });
    await client.streams.requests.use({ code: 'pump.start' }).describe();
    await isolated.streams.requests.use({ code: 'pump.start' }).describe();
    expect(currentFetch.mock.calls[0]?.[0]).toBe('https://configured.example/openapi/v2/stream-requests/pump.start/describe');
    expect(isolatedFetch.mock.calls[0]?.[0]).toBe('https://isolated.example/openapi/v2/stream-requests/pump.start/describe');
    // 平台 API 与交互使用同一份动态配置。
    await client.api.system.info();
    expect(currentFetch).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect a previous App identity on runtime removal', () => {
    const first = { appId: 'first-app', request: async () => Response.json({}) };
    const second = { appId: 'second-app', request: async () => Response.json({}) };
    const removeFirst = installAppRuntime(first);
    const removeSecond = installAppRuntime(second);
    removeFirst();
    expect(getAppRuntime()).toBe(second);
    removeSecond();
    expect(getAppRuntime()).toBeUndefined();
  });

  it.each(['requests', 'capabilities', 'appCapabilities', 'uns'] as const)('uses the current default timeout for %s while isolated configuration stays fixed', async domain => {
    vi.useFakeTimers();
    const pending = vi.fn(() => new Promise<Response>(() => {}));
    configureClient({ apiHost: 'https://configured.example', transportTimeoutMs: 10, fetch: pending });
    const isolated = createClient({ apiHost: 'https://isolated.example', transportTimeoutMs: 30, fetch: pending });
    const call = (sdk: typeof client) => domain === 'requests' ? sdk.streams.requests.use({ code: 'pump.start' }).describe()
      : domain === 'capabilities' ? sdk.capabilities.discover()
      : domain === 'appCapabilities' ? sdk.streams.capabilities.discover()
      : sdk.uns.recordFind({ collectionId: 'orders' });
    let isolatedSettled = false;
    const result = call(client).catch(error => error);
    const separate = call(isolated).catch(error => { isolatedSettled = true; return error; });
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBeInstanceOf(Error);
    expect(isolatedSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await separate).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
