import { describe, expect, it } from 'vitest';
import { createClient, createSourceClient, createStreamClient, createUnsDataClient } from '../src/index.js';
import { bindSourceClient } from '../src/source.js';
import { bindStreamClient } from '../src/stream.js';
import { bindUnsDataClient } from '../src/uns-v2/data-client.js';
import { createUnsV2Client } from '../src/uns-v2/client.js';
import { UNS_V2_OPERATIONS, type UnsV2OperationName } from '../src/uns-v2/generated.js';

// base exposes native Source state and Source resources since 0.9.11; the Edge inventory, which base's contract does not have yet, stays raw only.
// sourceOpcuaEndpoints (Backend 59cc52688, builder-side OPC UA endpoint discovery) stays in the raw table like the Edge inventory.
const NOT_IN_FACADES = ['edgeNodesList', 'sourceOpcuaEndpoints'];

function functions(object: object): unknown[] {
  return Object.values(object).flatMap(value => typeof value === 'function' ? [value] : functions(value));
}
describe('Source, Stream and UNS domain clients', () => {
  it('preserves the audited Source discovery side-effect classification without retrying', async () => {
    let calls = 0;
    const client = createClient({ apiHost: 'https://fixture.invalid', fetch: async () => {
      calls++;
      throw new Error('response lost after request');
    } });
    await expect(client.source.discover({ id: '101', expectedRevision: 1 })).rejects.toMatchObject({
      execution: 'unknown', outcomeUnknown: true,
    });
    expect(calls).toBe(1);
  });
  it.each(['source', 'stream', 'uns'] as const)('exposes the %s facade operations exactly once in its domain', domain => {
    const raw = createUnsV2Client();
    const client = { source: bindSourceClient(raw), stream: bindStreamClient(raw), uns: bindUnsDataClient(raw) }[domain];
    // The Backend's Edge inventory operation is in the raw table only, not in a facade.
    const expected = Object.keys(UNS_V2_OPERATIONS).filter(name => !NOT_IN_FACADES.includes(name)).filter(name => domain === 'uns'
      ? !/^(source|stream|control)/.test(name) : name.startsWith(domain) && !name.startsWith('streamRequest'));
    const actual = functions(client);
    expect(actual).toHaveLength(expected.length);
    expect(new Set(actual)).toEqual(new Set(expected.map(name => raw[name as UnsV2OperationName])));
    expect(Object.isFrozen(client)).toBe(true);
  });
  it('keeps the raw operation table complete while the facades omit the Edge inventory', () => {
    const raw = createUnsV2Client();
    for (const name of NOT_IN_FACADES) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
      expect(typeof raw[name as UnsV2OperationName]).toBe('function');
    }
    const facades = [bindSourceClient(raw), bindStreamClient(raw), bindUnsDataClient(raw)];
    for (const name of NOT_IN_FACADES) {
      for (const facade of facades) expect(functions(facade)).not.toContain(raw[name as UnsV2OperationName]);
    }
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
      dryRun: false, idempotencyKey: 'source-delete-101-rev2',
      id: '101', expectedRevision: 2, confirmedImpactRevision: 'si1_' + 'x'.repeat(43),
    };
    await expect(client.source.documents.delete(body)).rejects.toMatchObject({
      operation: 'sourceDocumentDelete', outcomeUnknown: true,
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
    // Neutral grant-management operations remain raw contracts, not a second
    // Stream interaction API on the data SDK's management facade.
    expect('requests' in client.stream).toBe(false);
    expect('messages' in client.stream).toBe(false);
    expect('streamRequestGrantGet' in client.uns).toBe(false);
  });
});
