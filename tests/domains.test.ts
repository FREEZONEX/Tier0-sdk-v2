import { describe, expect, it } from 'vitest';
import { createClient, createSourceClient, createStreamClient, createUnsDataClient } from '../src/index.js';
import { bindSourceClient } from '../src/source.js';
import { bindStreamClient } from '../src/stream.js';
import { bindUnsDataClient } from '../src/uns-v2/data-client.js';
import { createUnsV2Client, listUnsV2Methods } from '../src/uns-v2/client.js';
import { type UnsV2OperationName } from '../src/uns-v2/generated.js';

function functions(object: object): unknown[] {
  return Object.values(object).flatMap(value => typeof value === 'function' ? [value] : functions(value));
}
describe('Source, Stream and UNS domain clients', () => {
  it.each(['source', 'stream', 'uns'] as const)('exposes every public %s operation exactly once in its domain', domain => {
    const raw = createUnsV2Client();
    const client = { source: bindSourceClient(raw), stream: bindStreamClient(raw), uns: bindUnsDataClient(raw) }[domain];
    const expected = listUnsV2Methods('all').filter(name => domain === 'uns'
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
    await expect(source.list({}, { signal: cancelled.signal })).rejects.toThrow();
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
  it('forwards canonical Source and Stream alternatives while keeping compatibility routes unchanged', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const client = createClient({ apiHost: 'https://fixture.invalid', fetch: async (url, init) => {
      calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ code: 200, msg: '', requestId: 'fixture', data: {} }));
    } });
    const document = { name: 'orders', protocol: 'http' as const, config: { configVersion: 2 as const, endpoint: 'https://fixture.invalid', options: {} } };
    const patch = { name: 'renamed' };
    const confirmation = 'si1_' + 'a'.repeat(43);
    const program = { name: 'orders-stream', sdkVersion: 'tier0-stream/v2' as const, script: 'module.exports = api => {};', sourceBindings: [] };
    const requests = [
      { path: 'sources/documents/get', body: { id: '101', view: 'summary' } },
      { path: 'sources/documents/create', body: { dryRun: true, items: [{ document }] } },
      { path: 'sources/documents/update', body: { dryRun: false, id: '101', expectedRevision: 2, confirmedImpactRevision: confirmation, patch } },
      { path: 'sources/documents/update', body: { dryRun: true, items: [{ id: '101', expectedRevision: 3, confirmedImpactRevision: confirmation, patch }] } },
      { path: 'streams/documents/get', body: { id: '202', view: 'full' } },
      { path: 'streams/documents/create', body: { dryRun: true, program } },
      { path: 'streams/documents/validate', body: { program } },
      { path: 'sources/get', body: { id: '101' } },
      { path: 'streams/program/create', body: { dryRun: true, document: program } },
    ];
    await client.source.documents.get({ id: '101', view: 'summary' });
    await client.source.documents.create({ dryRun: true, items: [{ document }] });
    await client.source.documents.update({ dryRun: false, id: '101', expectedRevision: 2, confirmedImpactRevision: confirmation, patch });
    await client.source.documents.update({ dryRun: true, items: [{ id: '101', expectedRevision: 3, confirmedImpactRevision: confirmation, patch }] });
    await client.stream.documents.get({ id: '202', view: 'full' });
    await client.stream.documents.create({ dryRun: true, program });
    await client.stream.documents.validate({ program });
    await client.source.get({ id: '101' });
    await client.stream.programs.create({ dryRun: true, document: program });
    expect(calls).toEqual(requests.map(request => ({ ...request, path: '/openapi/v2/uns/' + request.path })));
    // oneOf constraints must not drop the parent integer codec.
    await expect(client.source.documents.update({ dryRun: true, id: '101', expectedRevision: 1.5, confirmedImpactRevision: confirmation, patch })).rejects.toThrow('integer');
    // A generic parent documents array must not hide a oneOf branch's field codec.
    await expect(client.uns.metadataInsertMany({ kind: 'directory', documents: [{ data: { name: 'A', schemaVersion: 1.5 } }] })).rejects.toThrow('integer');
    expect(calls).toHaveLength(requests.length);
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
