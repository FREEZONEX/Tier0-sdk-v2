import { describe, expect, it } from 'vitest';
import { createClient, createSourceClient, createStreamClient, createUnsDataClient } from '../src/index.js';
import { bindSourceClient } from '../src/source.js';
import { bindStreamClient } from '../src/stream.js';
import { bindUnsDataClient } from '../src/uns-v2/data-client.js';
import { createUnsV2Client } from '../src/uns-v2/client.js';
import { UNS_V2_OPERATIONS, type UnsV2OperationName } from '../src/uns-v2/generated.js';

function functions(object: object): unknown[] {
  return Object.values(object).flatMap(value => typeof value === 'function' ? [value] : functions(value));
}
describe('Source, Stream and UNS domain clients', () => {
  it.each(['source', 'stream', 'uns'] as const)('exposes every public %s operation exactly once in its domain', domain => {
    const raw = createUnsV2Client();
    const client = { source: bindSourceClient(raw), stream: bindStreamClient(raw), uns: bindUnsDataClient(raw) }[domain];
    const expected = Object.keys(UNS_V2_OPERATIONS).filter(name => domain === 'uns'
      ? !/^(source|stream|control)/.test(name) : name.startsWith(domain));
    const actual = functions(client);
    expect(actual).toHaveLength(expected.length);
    expect(new Set(actual)).toEqual(new Set(expected.map(name => raw[name as UnsV2OperationName])));
    expect(Object.isFrozen(client)).toBe(true);
  });
  it('keeps configuration isolated in standalone clients and forwards cancellation options', async () => {
    const received: { url: string; key: string | null; signal?: AbortSignal | null }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      received.push({ url: String(url), key: new Headers(init?.headers).get('x-api-key'), signal: init?.signal });
      return new Response(JSON.stringify({ code: 200, msg: '', requestId: 'fixture', data: {} }));
    };
    const config = { apiHost: 'https://fixture.invalid', apiKey: 'source-key', fetch: fetcher };
    const source = createSourceClient(config);
    config.apiKey = 'stream-key';
    const stream = createStreamClient(config);
    config.apiKey = 'data-key';
    const uns = createUnsDataClient(config);
    await source.documents.get({ id: '101' });
    await stream.observations.get({ id: '202' });
    await uns.recordFind({ collectionId: 'orders' });
    expect(received.map(item => item.key)).toEqual(['source-key', 'stream-key', 'data-key']);
    expect(received.map(item => item.url)).toEqual([
      'https://fixture.invalid/openapi/v2/uns/sources/documents/get',
      'https://fixture.invalid/openapi/v2/uns/streams/observation/get',
      'https://fixture.invalid/openapi/v2/uns/collections/orders/records:find',
    ]);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(source.documents.list({}, { signal: cancelled.signal })).rejects.toThrow();
    await expect(stream.programs.list({}, { signal: cancelled.signal })).rejects.toThrow();
    expect(received).toHaveLength(3);
  });
  it('retains a Source mutation intent unchanged and never retries an unknown result', async () => {
    const received: unknown[] = [];
    const client = createClient({
      apiHost: 'https://fixture.invalid',
      fetch: async (_url, init) => { received.push(JSON.parse(String(init?.body))); return new Response('truncated'); },
    });
    const body = {
      dryRun: false, idempotencyKey: 'source-disable-101-rev2',
      items: [{ id: '101', expectedRevision: 2, desiredState: 'disabled' as const, confirmedImpactRevision: 'si1_' + 'x'.repeat(43) }],
    };
    await expect(client.source.state.update(body)).rejects.toMatchObject({
      operation: 'sourceStateUpdate', outcomeUnknown: true,
    });
    expect(received).toEqual([body]);
  });
  it('does not expose cross-domain or arbitrary raw calls through the data facade', () => {
    const client = createClient();
    expect('sourceList' in client.uns).toBe(false);
    expect('streamProgramDeploy' in client.uns).toBe(false);
    expect('controlInvoke' in client.uns).toBe(false);
    expect('call' in client.uns).toBe(false);
    expect('transport' in client.uns).toBe(false);
  });
});
