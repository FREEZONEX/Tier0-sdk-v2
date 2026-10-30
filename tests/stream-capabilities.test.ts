import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { installAppRuntime } from '../src/runtime.js';

const item = { code: 'stream.requests.v1', state: 'ready', reasonCode: 'AVAILABLE', contractVersions: ['openapi/v2', 'stream-requests/v1'] };
const fixture = (capabilities: unknown[]) => ({ product: 'cloud', contractVersion: '2.0', apiContractVersions: ['openapi/v2'], sdkContractVersions: ['stream-requests/v1'], capabilities, deprecations: [] });
let remove: (() => void) | undefined;
afterEach(() => { remove?.(); remove = undefined; vi.unstubAllGlobals(); });

describe('App capability scope', () => {
  it('discovers request and invoke through the trusted browser bridge', async () => {
    vi.stubGlobal('window', {});
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const body = fixture([item, { ...item, code: 'stream.requests.invoke.v1', state: 'disabled', reasonCode: 'FORBIDDEN' }]);
    const request = vi.fn(async () => Response.json(body));
    remove = installAppRuntime({ appId: 'trusted-app', request });
    expect(await createClient().streams.capabilities.discover()).toEqual(body);
    expect(request).toHaveBeenCalledWith('/openapi/v2/capabilities/discover', {}, { signal: expect.any(AbortSignal) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps data and request contract versions isolated in both directions', async () => {
    const base = { code: 'namespace.v2', state: 'readiness_unknown', reasonCode: 'READINESS_NOT_ASSESSED', contractVersions: ['openapi/v2'] };
    let body = fixture([base, { ...item, contractVersions: ['future'] }]);
    const fetch = vi.fn(async () => Response.json(body));
    const sdk = createClient({ apiHost: 'https://fixture.invalid', fetch });
    expect((await sdk.capabilities.discover()).capabilities).toEqual([base]);
    await expect(sdk.streams.capabilities.discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_UNSUPPORTED_VERSION', retryable: false });
    body = fixture([{ ...base, contractVersions: ['future'] }, item]);
    expect((await sdk.streams.capabilities.discover()).capabilities).toEqual([item]);
    await expect(sdk.capabilities.discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_UNSUPPORTED_VERSION', retryable: false });
  });

  it('does not downgrade missing browser authentication to server credentials', async () => {
    vi.stubGlobal('window', {});
    const fetch = vi.fn();
    await expect(createClient({ apiHost: 'https://fixture.invalid', apiKey: 'server-only', fetch }).streams.capabilities.discover())
      .rejects.toMatchObject({ errorCode: 'CAPABILITY_TRANSPORT_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
