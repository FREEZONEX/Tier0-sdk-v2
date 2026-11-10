import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '../src/client.js';

const item = { code: 'stream.requests.v1', state: 'ready', reasonCode: 'AVAILABLE', contractVersions: ['openapi/v2', 'stream-requests/v1'] };
const fixture = (capabilities: unknown[]) => ({ product: 'cloud', contractVersion: '2.0', apiContractVersions: ['openapi/v2'], sdkContractVersions: ['stream-requests/v1'], capabilities, deprecations: [] });
afterEach(() => { vi.unstubAllGlobals(); });

describe('App capability scope', () => {
  it('preserves request invocation readiness and its resource authorization boundary', async () => {
    const invoke = { ...item, code: 'stream.requests.invoke.v1', operations: [{ operation: 'invoke', state: 'ready', reasonCode: 'READY', requiresResourceCheck: true }] };
    const fetch = vi.fn(async () => Response.json(fixture([invoke])));
    const sdk = createClient({ apiHost: 'https://fixture.invalid', fetch });
    expect((await sdk.streams.capabilities.discover()).capabilities[0].operations).toEqual(invoke.operations);
    const denied = { ...invoke, operations: [{ ...invoke.operations[0], requiresResourceCheck: false }] };
    fetch.mockImplementation(async () => Response.json(fixture([denied])));
    await expect(sdk.streams.capabilities.discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_PROTOCOL_ERROR' });
  });

  it('consumes the pinned shared request invocation vector', async () => {
    const vectors = JSON.parse(readFileSync(new URL('../contracts/capability-discovery/vectors.json', import.meta.url), 'utf8')) as { name: string; response: unknown }[];
    const vector = vectors.find((value) => value.name === 'cloud-request-invoke-resource-check');
    expect(vector).toBeDefined();
    const fetch = vi.fn(async () => Response.json(vector!.response));
    const sdk = createClient({ apiHost: 'https://fixture.invalid', fetch });
    expect((await sdk.streams.capabilities.discover()).capabilities[0].operations?.[0]).toMatchObject({ operation: 'invoke', requiresResourceCheck: true });
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
});
