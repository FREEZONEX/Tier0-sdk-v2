import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sdk from '../src/index.js';

// Execute the actual Markdown snippets, not a separately maintained copy.
function example(domain: string, file: string, index = 0): Record<string, (...args: any[]) => any> {
  const markdown = readFileSync(new URL('../skills/tier0-sdk-v2/tier0-sdk-v2-' + domain + '/references/' + file + '.md', import.meta.url), 'utf8');
  const blocks = [...markdown.matchAll(/^\x60\x60\x60(?:ts|typescript)\r?\n([\s\S]*?)^\x60\x60\x60/gm)];
  if (!blocks[index]) throw new Error('Missing documentation example');
  return compileExample(blocks[index][1]);
}

function packageExample(file: string): Record<string, (...args: any[]) => any> {
  return compileExample(readFileSync(new URL('../examples/' + file + '.ts', import.meta.url), 'utf8'));
}

function compileExample(input: string): Record<string, (...args: any[]) => any> {
  const code = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: (name: string) => {
    if (name !== '@tier0/sdk-v2') throw new Error('Unexpected import: ' + name);
    return sdk;
  } });
  return exports;
}

type Step = { path: string; check?: (body: any) => void; data?: any; raw?: string; status?: number };
let steps: Step[] = [];
let failures: unknown[] = [];
let calls: { path: string; body: any }[] = [];
let client: sdk.Tier0Client;
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const path = req.url!.replace('/openapi/v2/uns/', '');
  calls.push({ path, body });
  const step = steps.shift();
  try {
    expect(req.method).toBe('POST');
    expect(step, 'Unexpected request: ' + path).toBeDefined();
    expect(path).toBe(step!.path);
    step!.check?.(body);
    res.writeHead(step!.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(step!.raw ?? JSON.stringify({ code: 200, msg: '', requestId: 'skill-fixture', data: step!.data }));
  } catch (error) {
    failures.push(error);
    res.writeHead(500);
    res.end('fixture assertion failed');
  }
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  client = sdk.createClient({ apiHost: 'http://127.0.0.1:' + (server.address() as AddressInfo).port, apiKey: 'fixture-key' });
});
beforeEach(() => { steps = []; failures = []; calls = []; });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
function finished() { expect(failures).toEqual([]); expect(steps).toEqual([]); }
const preview = { validated: true, sideEffects: false };
const outcome = (status = 'committed') => ({ status, replayed: false, results: [] });
const page = (list: unknown[]) => ({ list, total: list.length, page: 1, size: 200,
  hasMore: false, complete: true, truncated: false, snapshotScope: 'thisRequestOnly' });
const source = (revision = 1, name = 'orders') => ({
  id: '9007199254740993', revision, document: { name, protocol: 'http-api', description: '订单系统 HTTP 接入',
    role: 'client', endpoint: 'https://fixture.invalid', http: { anonymous: true } },
  runtimeState: 'stopped', health: 'unknown', createdAt: 1, updatedAt: 1,
});
const token = 'si1_' + 'a'.repeat(43); // Fixture-only server-issued confirmation.
const impact = (action = 'update', revision = 1) => ({
  impactRevision: token, sourceID: source().id, sourceRevision: revision, action, complete: 1,
  counts: { draft: 0, activeRelease: 0, historicalRelease: 0 }, restrictedCount: 0,
  references: [], nextOffset: 0, expiresAt: 9999999999999,
});
const stream = (revision = 1, description = '', activeRelease = 0) => ({
  id: '9007199254740995', revision, document: { name: 'orders-stream', model: 'program', description,
    script: { code: 'module.exports=api=>{};', timeoutMs: 5000 },
    sources: [{ alias: 'orders', sourceId: source().id, configRevision: 1, resources: [], acquisition: {} }],
    entries: [] },
  status: activeRelease ? 'active' : 'draft', activeVersion: activeRelease ? '9007199254740997' : '0', activeRelease, createdAt: 1, updatedAt: 1,
});
const collection = (revision = 1) => ({ kind: 'collection', id: 'devices', revision,
  data: { schemaVersion: 1, name: 'devices', recordSchema: { type: 'object', properties: {
    name: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['name', 'enabled'] } } });
const record = (revision = 1, name = 'pump') => ({ id: 'device-1', collectionId: 'devices', revision,
  data: { name, enabled: true }, createdAt: 1, updatedAt: 1 });
const records = (...items: unknown[]) => ({ items, pageInfo: { hasMore: false } });

describe('Skill examples over localhost HTTP (not a live Tier0 deployment)', () => {
  it.each(['source', 'stream'])('reads a %s summary without requiring full-document access or observations', async domain => {
    const current = domain === 'source' ? source() : stream();
    steps = [{ path: `${domain}s/documents/get`, check: body => expect(body).toEqual({ id: current.id, view: 'summary' }), data: current }];
    if (domain === 'source') {
      const result = await client.source.documents.get({ id: current.id, view: 'summary' });
      expect(result.data.id).toBe(current.id);
    } else {
      const result = await client.stream.documents.get({ id: current.id, view: 'summary' });
      expect(result.data.id).toBe(current.id);
    }
    expect(calls).toHaveLength(1);
    finished();
  });

  it('traverses Source summary pages without loading full documents', async () => {
    steps = [
      { path: 'sources/documents/list', check: body => expect(body).toEqual({ page: 1, size: 100, includeDocument: false }),
        data: { list: [source()], total: 2, page: 1, hasMore: true, nextPage: 2 } },
      { path: 'sources/documents/list', check: body => expect(body).toEqual({ page: 2, size: 100, includeDocument: false }),
        data: { list: [source(2)], total: 2, page: 2, hasMore: false, nextPage: 0 } },
    ];
    const pages = [];
    for await (const result of example('source', 'read').listSources(client)) pages.push(result);
    expect(pages).toEqual([[source()], [source(2)]]);
    expect(calls).toHaveLength(2);
    finished();
  });

  it('reads existing collection records without requiring metadata access', async () => {
    steps = [{ path: 'collections/devices/records:find', data: records(record()) }];
    const result = await example('uns', 'read').readRecords('devices', client);
    expect(result.data.items).toEqual([record()]);
    expect(result.data.pageInfo.hasMore).toBe(false);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('propagates record authorization failure without discovery or retries', async () => {
    steps = [{ path: 'collections/devices/records:find', status: 403, raw: JSON.stringify({
      code: 403, msg: 'Collection not granted', requestId: 'denied', data: { reason: 'COLLECTION_NOT_GRANTED' },
      error: { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } },
    }) }];
    await expect(example('uns', 'read').readRecords('devices', client)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(calls).toHaveLength(1);
    finished();
  });

  it.each([0, 0n])('initializes an uncreated App policy when its revision is %s', async revision => {
    const appId = '11111111-2222-4333-8444-555555555555';
    steps = [
      { path: 'app-data-policy/get', check: body => expect(body).toEqual({ appId }),
        data: { appId, revision: 0, status: 'disabled', collections: [], authorityStatus: 'available' } },
      { path: 'app-data-policy/update', check: body => expect(body).toEqual({
        appId, expectedRevision: 0, status: 'active',
        changes: [{ action: 'upsert', collectionId: 'devices', permissions: ['record:read'] }],
        idempotencyKey: 'grant-devices', dryRun: false,
      }), data: outcome() },
    ];
    // Exercise both zero representations while keeping the actual HTTP fixture valid JSON.
    const accessClient = { ...client, uns: { ...client.uns,
      appDataPolicyGet: async (request: sdk.CloudAppDataPolicyGetReq) => {
        const response = await client.uns.appDataPolicyGet(request);
        return { ...response, data: { ...response.data, revision } };
      },
    } };
    const result = await example('uns', 'update', 1).grantRead(appId, 'devices', 'grant-devices', accessClient);
    expect(result.data.status).toBe('committed');
    expect(calls).toHaveLength(2);
    finished();
  });

  it('stops before writing when an existing App policy is disabled', async () => {
    const appId = '11111111-2222-4333-8444-555555555555';
    steps = [{ path: 'app-data-policy/get', check: body => expect(body).toEqual({ appId }),
      data: { appId, revision: 4, status: 'disabled', collections: [], authorityStatus: 'available' } }];
    await expect(example('uns', 'update', 1).grantRead(appId, 'devices', 'grant-devices', client))
      .rejects.toThrow('App 数据策略已停用');
    expect(calls).toHaveLength(1);
    finished();
  });

  it('documents only HTTP paths present in the pinned SDK contract', () => {
    const paths = new Set<string>(Object.values(sdk.UNS_V2_OPERATIONS).map(operation => operation.path));
    for (const domain of ['source', 'stream', 'uns']) {
      const dir = new URL('../skills/tier0-sdk-v2/tier0-sdk-v2-' + domain + '/references/', import.meta.url);
      for (const name of readdirSync(dir).filter(name => name.endsWith('.md'))) {
        const content = readFileSync(new URL(name, dir), 'utf8');
        for (const match of content.matchAll(/\/openapi\/v2\/[A-Za-z0-9_/:{}-]+/g)) {
          const path = match[0].replace(/\{(\w+)\}/g, ':$1');
          expect(paths.has(path), domain + '/' + name + ': ' + path).toBe(true);
        }
      }
    }
  });
  it('executes unreferenced Source create, rename and delete without assuming a state-management prerequisite', async () => {
    steps = [
      { path: 'sources/documents/create', check: b => expect(b).toMatchObject({
        dryRun: false, idempotencyKey: 'create-source', document: source().document }), data: source() },
      { path: 'sources/documents/update', check: b => expect(b).toEqual({
        id: source().id, dryRun: false, expectedRevision: 1, idempotencyKey: 'rename-source',
        patch: { name: 'renamed' } }), data: source(2, 'renamed') },
      { path: 'sources/documents/delete', check: b => expect(b).toMatchObject({ id: source().id, expectedRevision: 2 }), data: { id: source().id } },
    ];
    const created = await example('source', 'create').createSource(source().document, undefined, 'create-source', client);
    expect(created.data).toEqual(source());
    const changed = await example('source', 'update').renameSource(created.data.id, created.data.revision, 'renamed', 'rename-source', client);
    expect(changed.data).toEqual(source(2, 'renamed'));
    const deleted = await example('source', 'delete').deleteSource(changed.data.id,
      changed.data.revision, 'delete-source', client);
    expect(deleted.data).toEqual({ id: source().id });
    expect(calls).toHaveLength(3);
    finished();
  });

  it('composes the authenticated Source and HTTP Stream examples without turning request GET into a credential restriction', async () => {
    const endpoint = 'https://fixture.invalid/api/v1';
    const current = { ...source(), document: { ...source().document,
      endpoint, credentialRef: 'fixture-ref', http: { authentication: 'bearer' } } };
    let script = '';
    steps = [
      { path: 'sources/documents/create', check: b => {
        expect(b).toMatchObject({ dryRun: false, idempotencyKey: 'create-authenticated',
          document: { endpoint } });
        expect(b.credentials).toEqual({ kind: 'bearer', secret: 'fixture-only' });
      }, data: current },
      { path: 'streams/documents/create', check: b => {
        expect(b.program.sourceBindings).toEqual([{ sourceId: current.id, configRevision: current.revision, acquisition: {} }]);
        script = b.program.script.code;
        expect(script).not.toContain('fixture-only');
        expect(script).not.toContain('fixture-ref');
      }, data: stream() },
    ];
    const created = await example('source', 'create').createSource(
      { name: 'inventory', protocol: 'http-api', role: 'client', endpoint, http: { authentication: 'bearer' } },
      { kind: 'bearer', secret: 'fixture-only' }, 'create-authenticated', client);
    expect(created.data).toEqual(current);
    await example('stream', 'create').createHttpStream(created.data, 'inventory', 'inventory-stream', 'create-stream', client);
    const module = { exports: undefined as unknown as (api: unknown) => void };
    runInNewContext(script, { module });
    const request = vi.fn().mockResolvedValue({ status: 200, data: [{ sku: 'fixture-sku', quantity: 12 }] });
    const write = vi.fn();
    const output = vi.fn().mockReturnValue({ write });
    const use = vi.fn().mockReturnValue({ request });
    const onTimer = vi.fn();
    module.exports({ sources: { use }, uns: { use: output }, stream: { onTimer } });
    expect(use).toHaveBeenCalledWith({ id: current.id, resources: [] });
    expect(request).not.toHaveBeenCalled();
    expect(onTimer.mock.calls[0][0]).toEqual({ id: 'inventory', intervalMs: 60000 });
    await expect(onTimer.mock.calls[0][1]()).resolves.toBeUndefined();
    expect(output).toHaveBeenCalledWith({ collectionId: 'inventory', access: 'write' });
    expect(write).toHaveBeenCalledExactlyOnceWith({ recordId: 'fixture-sku', record: { sku: 'fixture-sku', quantity: 12 } });
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: 'inventory?limit=40' });
    expect(calls).toHaveLength(2);
    finished();
  });

  it.each([
    { kind: 'basic', username: 'fixture-user', secret: 'fixture-only' },
    { kind: 'bearer', secret: 'fixture-only' },
    { kind: 'custom', values: { 'X-Plex-Connect-Api-Key': 'fixture-only' } },
    { kind: 'oauth2', secret: 'fixture-only' },
  ])('creates inline $kind credentials without inventing a client-side method default', async credentials => {
    const document = { name: 'orders', protocol: credentials.kind === 'oauth2' ? 'oauth2' : 'http-api',
      role: 'client', endpoint: 'https://fixture.invalid',
      http: credentials.kind === 'oauth2' ? { oauth: { grantType: 'client_credentials',
        tokenUrl: 'https://fixture.invalid/token', clientId: 'fixture-client', clientAuthentication: 'client_secret_post' } }
        : { authentication: credentials.kind } };
    steps = [{ path: 'sources/documents/create', check: body => {
      expect(body).toEqual({ dryRun: false, idempotencyKey: 'create-inline',
        document, credentials });
      expect(JSON.stringify(body.document)).not.toContain('fixture-only');
    }, data: source() }];
    const created = await example('source', 'create').createSource(document, credentials, 'create-inline', client);
    expect(created.data).toEqual(source());
    expect(calls).toHaveLength(1);
    finished();
  });

  it('imports the exact generic HTTP authentication header without exposing the secret in the Source document', async () => {
    steps = [{ path: 'sources/documents/create', check: body => {
      expect(body.credentials).toEqual({ kind: 'custom', values: { 'X-Plex-Connect-Api-Key': 'fixture-header-secret' } });
      expect(body.document).toEqual({ name: 'custom-api', protocol: 'http-api', role: 'client',
        endpoint: 'https://fixture.invalid/api/', http: { authentication: 'custom' } });
      expect(JSON.stringify(body.document)).not.toContain('fixture-header-secret');
      expect(body.document.sourceType).toBeUndefined();
    }, data: source() }];
    const receipt = await example('source', 'create', 1).createCustomHeaderSource(
      'https://fixture.invalid/api/', 'custom-api', 'fixture-header-secret', 'header-create', client);
    expect(JSON.stringify(receipt)).not.toContain('fixture-header-secret');
    expect(calls).toHaveLength(1);
    finished();
  });

  it('preserves the semantic apiKey field for a Plex template instead of renaming it as a generic HTTP header', async () => {
    const document = { name: 'plex', protocol: 'http-api', sourceType: 'plex-mes', role: 'client',
      endpoint: 'https://fixture.invalid/', http: { authentication: 'custom', parameters: { tenantId: 'tenant', pcn: '123456' } } };
    const credentials = { kind: 'custom', values: { apiKey: 'fixture-plex-secret' } };
    steps = [{ path: 'sources/documents/create', check: body => {
      expect(body.document).toEqual(document);
      expect(body.credentials).toEqual(credentials);
      expect(JSON.stringify(body.document)).not.toContain('fixture-plex-secret');
    }, data: source() }];
    await example('source', 'create').createSource(document, credentials, 'plex-create', client);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('keeps Source impact review separate from explicitly confirming a referenced connection change', async () => {
    const config = { role: 'client', endpoint: 'https://changed.invalid', http: { anonymous: true } };
    steps = [{ path: 'sources/impact', check: b => expect(b).toMatchObject({
      id: source().id, expectedRevision: 1, action: 'update', patch: config,
    }), data: { ...impact(), counts: { draft: 1, activeRelease: 0, historicalRelease: 0 } } }];
    const workflow = example('source', 'update', 1);
    const reviewed = await example('source', 'changes').collectSourceImpact({
      id: source().id, expectedRevision: 1, action: 'update', patch: config,
    }, client);
    expect(reviewed.counts.draft).toBe(1);
    expect(calls).toHaveLength(1);
    finished();
    steps = [{ path: 'sources/documents/update', check: b => expect(b).toEqual({
      id: source().id, expectedRevision: 1, patch: config,
      confirmedImpactRevision: token, dryRun: false, idempotencyKey: 'reviewed-config-change',
    }), data: { ...source(2), document: { ...source(2).document, ...config } } }];
    const changed = await workflow.updateSourceWithImpact(source().id, 1, config, reviewed.impactRevision,
      'reviewed-config-change', client);
    expect(changed.data).toEqual({ ...source(2), document: { ...source(2).document, ...config } });
    expect(calls).toHaveLength(2);
    finished();
  });


  it('keeps the same confirmation and intent while traversing Source impact pages', async () => {
    const ref = { kind: 'draft', streamID: stream().id, streamRevision: 1, release: 0,
      alias: 'orders', configRevision: 1, streamDeleted: 2, parentMissing: 2 };
    steps = [
      { path: 'sources/impact', data: { ...impact(), references: [ref], nextOffset: 1 } },
      { path: 'sources/impact', check: b => expect(b).toMatchObject({
        id: source().id, expectedRevision: 1, action: 'delete', offset: 1, impactRevision: token }),
        data: { ...impact(), references: [ref], nextOffset: 0 } },
    ];
    const result = await example('source', 'changes').collectSourceImpact({
      id: source().id, expectedRevision: 1, action: 'delete',
    }, client);
    expect(result.references).toHaveLength(2);
    finished();
  });

  it('creates an HTTP Server using the managed endpoint without Client credentials', async () => {
    const current = source();
    const serverDocument = { name: 'orders-in', protocol: 'http-api',
      role: 'server', endpoint: 'http://managed' };
    steps = [{ path: 'sources/documents/create', check: body => expect(body).toEqual({
      dryRun: false, idempotencyKey: 'create-server', document: serverDocument,
    }), data: { ...current, document: serverDocument } }];
    const created = await example('source', 'create').createSource(serverDocument, undefined, 'create-server', client);
    expect(created.data.document).toEqual(serverDocument);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('uses the public default Client role when the HTTP config omits role', async () => {
    const current = source();
    const { role: _role, ...document } = current.document;
    steps = [
      { path: 'streams/documents/create', check: body => {
        expect(body.program.sourceBindings[0].sourceId).toBe(current.id);
        expect(body.program.script.code).toContain('upstream.request');
      }, data: stream() },
    ];
    await example('stream', 'create').createHttpStream({ ...current, document }, 'inventory', 'orders-stream', 'create-stream', client);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('uses the returned Source configuration revision rather than its document revision', async () => {
    const current = { ...source(12), configRevision: 7 };
    steps = [{ path: 'streams/documents/create', check: body => {
      expect(body.program.sourceBindings).toEqual([{ sourceId: current.id, configRevision: 7, acquisition: {} }]);
    }, data: stream() }];
    await example('stream', 'create').createHttpStream(current, 'inventory', 'orders-stream', 'create-stream', client);
    expect(calls).toHaveLength(1);
    finished();
  });

  it.each([200, 401, 403, 429, 502])('HTTP collection example checks upstream status %s before accepting data', async status => {
    let script = '';
    steps = [{ path: 'streams/documents/create', check: body => { script = body.program.script.code; }, data: stream() }];
    await example('stream', 'create').createHttpStream(source(), 'inventory', 'inventory-stream', 'create-stream', client);
    const module = { exports: (_api: unknown) => {} };
    runInNewContext(script, { module });
    let handler: () => Promise<unknown> = async () => { throw new Error('Missing handler'); };
    const request = vi.fn().mockResolvedValue({ status, data: [{ sku: 'fixture', quantity: 3 }], headers: { secret: 'secret-marker' } });
    const write = vi.fn();
    module.exports({ sources: { use: () => ({ request }) }, uns: { use: () => ({ write }) }, stream: { onTimer: (entry: { intervalMs: number }, run: typeof handler) => {
      expect(entry.intervalMs).toBe(60000);
      handler = run;
    } } });
    if (status === 200) {
      await expect(handler()).resolves.toBeUndefined();
      expect(write).toHaveBeenCalledExactlyOnceWith({ recordId: 'fixture', record: { sku: 'fixture', quantity: 3 } });
      write.mockClear();
      request.mockResolvedValueOnce({ status: 200, data: { error: 'secret-marker' } });
      await expect(handler()).rejects.toThrow('Invalid inventory response');
      request.mockResolvedValueOnce({ status: 200, data: [{ sku: 'valid', quantity: 1 }, { sku: 'bad', quantity: 'not-a-number' }] });
      await expect(handler()).rejects.toThrow('Invalid inventory row');
    } else {
      await expect(handler()).rejects.toThrow('Invalid inventory response');
    }
    expect(write).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(status === 200 ? 3 : 1);
    finished();
  });

  it('saves a native HTTPServer Stream and registers its relative route and trusted request handler', async () => {
    const current = source(7);
    current.document.role = 'server';
    current.document.endpoint = 'http://managed';
    steps = [
      { path: 'streams/documents/create', check: body => {
        expect(body).not.toHaveProperty('program');
        expect(body.document.sources).toEqual([
          { alias: 'incoming', sourceId: current.id, configRevision: 7, resources: [] },
        ]);
        const server = {};
        let route: unknown;
        let handler: ((ctx: unknown) => unknown) | undefined;
        const module = { exports: undefined as unknown };
        runInNewContext(body.document.script.code, { module });
        (module.exports as (api: unknown) => void)({
          sources: { use: (alias: string) => { expect(alias).toBe('incoming'); return server; } },
          stream: { onRequest: (registration: unknown, fn: typeof handler) => { route = registration; handler = fn; } },
        });
        expect(route).toEqual({ id: 'orders', source: server, method: 'POST', path: '/orders/:id' });
        expect(handler!({ request: { params: { id: 'A-001' }, body: { quantity: 2 } } })).toEqual({
          status: 200, body: { orderId: 'A-001' },
        });
      }, data: stream() },
    ];
    const created = await example('stream', 'http-server').createHttpServerStream(current.id, 7, 'incoming-orders', 'save-route', client);
    expect(created.data).toEqual(stream());
    expect(calls).toHaveLength(1);
    finished();
  });

  it.each([
    ['http-api', 'client'], ['http-api', undefined], ['http_push', undefined], ['http', undefined],
  ])('standalone HTTPServer example rejects %s/%s before saving a route', async (protocol, role) => {
    const current = source();
    steps = [{ path: 'sources/documents/get', data: { ...current,
      document: { ...current.document, protocol, role } } }];
    await expect(packageExample('http-server').createHttpServerStream(
      current.id, 'incoming-orders', 'save-route', client,
    )).rejects.toThrow('此入站路由示例需要 HTTP API Server Source');
    expect(calls).toHaveLength(1);
    finished();
  });

  it.each([false, true])('standalone example awaits the early HTTP reply before bounded work; write failure=%s', async failWrite => {
    const current = source(7);
    current.document.role = 'server';
    current.document.endpoint = 'http://managed';
    let code = '';
    steps = [
      { path: 'sources/documents/get', data: current },
      { path: 'streams/documents/create', check: body => {
        expect(body.document.script.timeoutMs).toBe(5000);
        expect(body.document.sources[0]).toMatchObject({ sourceId: current.id, configRevision: 7 });
        code = body.document.script.code;
      }, data: stream() },
    ];
    await packageExample('http-server-early-reply').createHttpServerEarlyReplyStream(
      current.id, 'orders', 'early-orders', 'save-early-route', client,
    );
    const events: string[] = [];
    let finishReply!: () => void;
    const replyFinished = new Promise<void>(resolve => { finishReply = resolve; });
    const writeError = new Error('fixture write failed after reply');
    let handler!: (ctx: unknown) => Promise<unknown>;
    const module = { exports: undefined as unknown };
    runInNewContext(code, { module });
    (module.exports as (api: unknown) => void)({
      sources: { use: () => ({}) },
      uns: { use: (binding: unknown) => {
        expect(binding).toEqual({ collectionId: 'orders', access: 'write' });
        return { write: async (value: unknown) => {
          events.push('write');
          expect(value).toEqual({ recordId: 'A-001', record: { quantity: 2 } });
          if (failWrite) throw writeError;
        } };
      } },
      stream: { onRequest: (_route: unknown, fn: typeof handler) => { handler = fn; } },
    });
    const execution = handler({ request: { params: { id: 'A-001' }, body: { quantity: 2 } },
      reply: async (response: unknown) => {
        events.push('reply-start');
        expect(response).toEqual({ status: 202, body: { accepted: true, orderId: 'A-001' } });
        await replyFinished;
        events.push('reply-sent');
      },
    });
    expect(events).toEqual(['reply-start']);
    finishReply();
    if (failWrite) await expect(execution).rejects.toBe(writeError);
    else await expect(execution).resolves.toBeUndefined();
    expect(events).toEqual(['reply-start', 'reply-sent', 'write']);
    finished();
  });

  it.each([
    ['http-api', 'server'], ['http_push', undefined], ['http', undefined],
  ])('rejects %s/%s before creating an active-request Stream', async (protocol, role) => {
    const current = source();
    steps = [];
    await expect(example('stream', 'create').createHttpStream(
      { ...current, document: { ...current.document, protocol, role } },
      'inventory', 'orders-stream', 'create-stream', client,
    )).rejects.toThrow('Generic HTTP client Source required');
    expect(calls).toHaveLength(0);
    finished();
  });

  it('executes Stream Source binding, full-document update, deploy, guarded disable and deletion', async () => {
    steps = [
      { path: 'streams/documents/create', check: b => {
        expect(b.program.sourceBindings).toEqual([{ sourceId: source().id, configRevision: 1, acquisition: {} }]);
        expect(b.program.script.code).toContain('api.sources.use');
        expect(b.program.script.code).toContain('api.stream.onTimer');
      }, data: stream() },
      { path: 'streams/documents/update', check: b => expect(b).toMatchObject({
        expectedRevision: 1, document: { ...stream().document, description: 'updated' } }), data: stream(2, 'updated') },
      { path: 'streams/program/deploy', check: b => expect(b).toMatchObject({
        expectedRevision: 2, expectedActiveVersion: '0', dryRun: false, idempotencyKey: 'deploy-stream' }),
        data: { id: stream().id, revision: 2, activeVersion: '9007199254740997', activeRelease: 1 } },
      { path: 'streams/documents/disable', check: b => expect(b).toMatchObject({
        expectedRevision: 2, expectedActiveVersion: '9007199254740997' }), data: { id: stream().id, revision: 3, status: 'disabled', activeVersion: '0', activeRelease: 0 } },
      { path: 'streams/program/delete', check: b => expect(b.expectedRevision).toBe(3),
        data: { id: stream().id, revision: 3, deleted: true } },
    ];
    const created = await example('stream', 'create').createHttpStream(source(), 'inventory', 'orders-stream', 'create-stream', client);
    const id = created.data.id;
    const updated = await example('stream', 'update').updateStreamDescription(created.data, 'updated', 'update-stream', client);
    const deployed = await example('stream', 'deploy').deployStream(updated.data, 'deploy-stream', client);
    expect(deployed.data.activeRelease).toBe(1);
    const disabled = await client.stream.documents.disable({ id, expectedRevision: deployed.data.revision,
      expectedActiveVersion: deployed.data.activeVersion, dryRun: false, idempotencyKey: 'disable-stream' });
    if (!('revision' in disabled.data)) throw new Error('Missing disabled revision');
    const deleted = await example('stream', 'delete').deleteStream(id, disabled.data.revision, 'delete-stream', client);
    expect(deleted.data.id).toBe(id);
    expect(calls).toHaveLength(5);
    finished();
  });

  it('preserves the caller revision when updating a Stream', async () => {
    steps = [{ path: 'streams/documents/update', check: body => {
      expect(body.expectedRevision).toBe(1);
      expect(body.document).toEqual({ ...stream().document, description: 'change' });
    }, status: 409, raw: JSON.stringify({ code: 409, msg: 'changed', requestId: 'conflict-fixture', data: null,
      error: { code: 'VERSION_CONFLICT', details: [], execution: 'notStarted', retry: { safe: false } } }) }];
    await expect(example('stream', 'update').updateStreamDescription(
      stream(), 'change', 'stale-update', client,
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT', requestId: 'conflict-fixture' });
    expect(calls).toHaveLength(1);
    finished();
  });

  it('previews and executes the documented exact sample deletion using the selected identities', async () => {
    const samples = [{ recordId: 'singapore', id: 'extra-1', time: 1794232800000 }];
    steps = [true, false].map(dryRun => ({ path: 'collections/weather/samples:deleteExact', check: body => expect(body).toEqual({
      collectionId: 'weather', samples, dryRun, idempotencyKey: 'remove-extra-weather',
    }), data: { deletedCount: 1, missingCount: 0, dryRun } }));
    const { deleteSelectedSamples } = example('uns', 'delete', 2);
    const preview = await deleteSelectedSamples('weather', samples, 'remove-extra-weather', true, client);
    const deleted = await deleteSelectedSamples('weather', samples, 'remove-extra-weather', false, client);
    expect(preview.data).toEqual({ deletedCount: 1, missingCount: 0, dryRun: true });
    expect(deleted.data).toEqual({ deletedCount: 1, missingCount: 0, dryRun: false });
    expect(calls).toHaveLength(2);
    finished();
  });

  it('submits the documented collection purge without claiming completion', async () => {
    steps = [{ path: 'metadata:purge', check: body => expect(body).toEqual({
      kind: 'collection', ids: ['devices'], idempotencyKey: 'purge-devices',
    }), data: { status: 'accepted', jobId: 'purge-job', replayed: false, results: [] } }];
    const result = await example('uns', 'delete', 3).purgeCollections(['devices'], 'purge-devices', client);
    expect(result.data).toMatchObject({ status: 'accepted', jobId: 'purge-job' });
    expect(calls).toHaveLength(1);
    finished();
  });

  it('executes Collection and Record writes with returned snapshots and caller revisions', async () => {
    steps = [
      { path: 'metadata', check: b => {
        expect(b).toMatchObject({ idempotencyKey: 'create-collection', data: { parentId: 'workshop-1' } });
        expect(b.data.recordSchema.required).toEqual(['code']);
        expect(b.data.recordSchema.properties.quantity).toEqual({ type: 'integer', format: 'int32' });
      }, data: { ...outcome(), insertedId: 'devices' } },
      { path: 'collections/devices/records', check: b => expect(b).toMatchObject({
        id: 'device-1', data: { code: 'WO-1' }, returnDocument: 'after', idempotencyKey: 'insert-record',
      }), data: { insertedId: 'device-1', value: record(), status: 'committed', replayed: false } },
      { path: 'collections/devices/records:updateOne', check: b => expect(b).toMatchObject({
        filter: { _id: 'device-1' }, expectedRevision: 1, update: { $set: { name: 'pump-2' } }, returnDocument: 'after',
      }), data: { ...outcome(), matchedCount: 1, modifiedCount: 1, value: record(2, 'pump-2') } },
      { path: 'collections/devices/records:deleteOne', check: b => expect(b.expectedRevision).toBe(2),
        data: { ...outcome(), deletedCount: 1 } },
      { path: 'collections/devices/records:restore', data: { ...outcome(), restoredCount: 1, restoredIds: ['device-1'] } },
      { path: 'metadata:deleteOne', check: b => expect(b.expectedRevision).toBe(3), data: { ...outcome(), deletedCount: 1 } },
      { path: 'metadata:restore', check: b => expect(b.items[0].expectedRevision).toBe(4), data: { ...outcome(), restoredCount: 1 } },
    ];
    const created = await example('uns', 'create').createCollection('workshop-1', 'create-collection', client);
    expect(created.data.insertedId).toBe('devices');
    const inserted = await example('uns', 'create', 1).insertOrder('devices', 'device-1', 'WO-1', 'insert-record', client);
    expect(inserted.value).toEqual(record());
    const updated = await example('uns', 'update').renameRecord('devices', 'device-1', 1, 'pump-2', 'update-record', client);
    expect(updated.data.value).toEqual(record(2, 'pump-2'));
    expect((await example('uns', 'delete').deleteRecord('devices', 'device-1', 2, 'delete-record', client)).data.deletedCount).toBe(1);
    expect((await example('uns', 'restore').restoreRecord('devices', 'device-1', 'restore-record', client)).data.restoredIds).toEqual(['device-1']);
    expect((await example('uns', 'delete', 1).deleteCollection('devices', 3, 'delete-collection', client)).data.deletedCount).toBe(1);
    expect((await example('uns', 'restore').restoreCollection('devices', 4, 'restore-collection', client)).data.restoredCount).toBe(1);
    expect(calls).toHaveLength(7);
    finished();
  });

  it.each([
    { file: 'delete', index: 0, method: 'deleteRecord', args: ['devices', 'device-1', 2, 'delete-record'],
      path: 'collections/devices/records:deleteOne', data: { ...outcome(), deletedCount: 0 } },
    { file: 'delete', index: 1, method: 'deleteCollection', args: ['devices', 3, 'delete-collection'],
      path: 'metadata:deleteOne', data: { ...outcome(), deletedCount: 0 } },
    { file: 'restore', index: 0, method: 'restoreRecord', args: ['devices', 'device-1', 'restore-record'],
      path: 'collections/devices/records:restore', data: { ...outcome(), restoredCount: 0, restoredIds: [] } },
    { file: 'restore', index: 0, method: 'restoreCollection', args: ['devices', 4, 'restore-collection'],
      path: 'metadata:restore', data: { ...outcome(), restoredCount: 0, items: [] } },
  ])('preserves zero affected counts for $method without dependent reads', async test => {
    steps = [{ path: test.path, data: test.data }];
    const result = await example('uns', test.file, test.index)[test.method](...test.args, client);
    expect(result.data).toEqual(test.data);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('preserves the caller revision and propagates a collection deletion conflict', async () => {
    steps = [{ path: 'metadata:deleteOne', check: body => expect(body).toMatchObject({
      filter: { _id: 'devices' }, expectedRevision: 3, idempotencyKey: 'stale-delete',
    }), status: 409, raw: JSON.stringify({ code: 409, msg: 'changed', requestId: 'delete-conflict', data: null,
      error: { code: 'VERSION_CONFLICT', details: [], execution: 'notStarted', retry: { safe: false } } }) }];
    await expect(example('uns', 'delete', 1).deleteCollection('devices', 3, 'stale-delete', client))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', requestId: 'delete-conflict' });
    expect(calls).toHaveLength(1);
    finished();
  });

  it('leaves an unknown restore outcome for caller reconciliation without readback or replay', async () => {
    steps = [{ path: 'metadata:restore', check: body => expect(body).toMatchObject({
      items: [{ id: 'devices', expectedRevision: 4 }], idempotencyKey: 'restore-unknown',
    }), raw: 'truncated response' }];
    await expect(example('uns', 'restore').restoreCollection('devices', 4, 'restore-unknown', client))
      .rejects.toBeInstanceOf(sdk.UnsV2OutcomeUnknownError);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('does not treat an unconfirmed metadata mutation as committed or perform dependent reads', async () => {
    steps = [
      { path: 'metadata', check: b => expect(b.data.parentId).toBeNull(), data: outcome('unconfirmed') },
    ];
    const result = await example('uns', 'create').createCollection(null, 'create', client);
    expect(result.data.status).toBe('unconfirmed');
    finished();
  });

  it('does not retry a Source mutation after an unknown transport result', async () => {
    steps = [{ path: 'sources/documents/delete', raw: 'truncated response' }];
    await expect(example('source', 'delete').deleteSource(source().id, 1, 'delete', client, token))
      .rejects.toBeInstanceOf(sdk.UnsV2OutcomeUnknownError);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('does not upsert when updating an absent Record', async () => {
    steps = [{ path: 'collections/devices/records:updateOne', check: body => {
      expect(body.upsert ?? false).toBe(false);
      expect(body.filter).toEqual({ _id: 'missing' });
    }, data: { ...outcome(), matchedCount: 0, modifiedCount: 0, value: null } }];
    const result = await example('uns', 'update').renameRecord('devices', 'missing', 1, 'new', 'rename', client);
    expect(result.data.matchedCount).toBe(0);
    expect(result.data.value).toBeNull();
    expect(calls).toHaveLength(1);
    finished();
  });

  it('sends the migrated notification example with inbox type, no mode and v2 App identity', async () => {
    vi.stubEnv('APP_ID', 'da6aa4b6-1a8f-43b7-86ed-73818fe22550');
    steps = [
      { path: '/openapi/v2/notifications/send', check: body => {
        expect(body).toMatchObject({ recipientUserId: '9007199254740993', type: 'inbox',
          idempotencyKey: 'work-order-event-v1', channels: ['web', 'mobile'],
          sender: { type: 'app', id: 'da6aa4b6-1a8f-43b7-86ed-73818fe22550' } });
        expect(body).not.toHaveProperty('mode');
        expect(body.sender).not.toHaveProperty('meta');
        expect(body.sender).not.toHaveProperty('name');
      }, raw: JSON.stringify({ messageId: '9007199254740997', status: 'accepted', createdAt: '2026-10-22T00:00:00Z' }) },
      { path: '/openapi/v2/notifications/get', check: body => expect(body.messageId).toBe('9007199254740997'),
        raw: JSON.stringify({ messageId: '9007199254740997', type: 'inbox', status: 'accepted', createdAt: '2026-10-22T00:00:00Z' }) },
    ];
    try {
      const sent = await example('notifications', 'send').sendCompletedOrder(
        '9007199254740993', 'work-order', 'work-order-event-v1', client);
      const status = await example('notifications', 'get').waitForNotification(sent.messageId, client, 1);
      expect(status.status).toBe('accepted');
      expect(calls).toHaveLength(2);
      finished();
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps unnamed member IDs internal instead of using them as display labels', async () => {
    steps = [{ path: '/openapi/v2/platform/getMembers', check: body => expect(body.statuses).toEqual(['active']),
      data: { list: [{ userId: '9007199254740993', status: 'active', roles: [], updatedAt: '2026-10-22T00:00:00Z' }],
        page: 1, size: 20, total: 1 } }];
    const result = await example('members', 'platform-members').memberOptions('pump', 1, client);
    expect(result.options[0]).toMatchObject({ value: '9007199254740993', label: '未命名成员' });
    finished();
  });

  it('lists App members by explicit appId and branches unavailable access lists by code', async () => {
    const path = '/openapi/v2/apps/access-members/list';
    steps = [
      { path, check: body => expect(body).toEqual({ appId: 'app-1', page: 1, size: 20 }),
        data: { appId: 'app-1', published: 1, allActiveMembers: 2, roles: [], total: 1, page: 1, size: 20,
          list: [{ userId: '42', email: 'a@example.com', grantedAt: 1700000050000, roles: [{ roleId: 'r-1', roleKey: 'operator', roleName: 'Operator', sources: [{ type: 'direct' }] }] }] } },
      { path, raw: JSON.stringify({ code: 3003016, msg: 'App access list cannot be determined' }) },
      { path, raw: JSON.stringify({ code: 3003017, msg: 'App access list is temporarily unavailable' }) },
    ];
    const { appMembers } = example('members', 'app-members');
    const result = await appMembers(1, client, 'app-1');
    expect(result.list).toEqual([{ userId: '42', label: 'a@example.com', roles: ['Operator'] }]);
    await expect(appMembers(1, client, 'app-1')).rejects.toThrow('重新部署 App');
    await expect(appMembers(1, client, 'app-1')).rejects.toThrow('稍后重试');
    finished();
  });
});
