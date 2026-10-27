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
  const code = ts.transpileModule(blocks[index][1], {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: (name: string) => {
    if (name !== '@tier0/sdk-v2') throw new Error('Unexpected import: ' + name);
    return sdk;
  } });
  return exports;
}

type Step = { path: string; check?: (body: any) => void; data?: any; raw?: string };
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
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
    config: { configVersion: 2, role: 'client', endpoint: 'https://fixture.invalid', options: {} } },
  desiredState: 'disabled', runtimeState: 'stopped', health: 'unknown', createdAt: 1, updatedAt: 1,
});
const token = 'si1_' + 'a'.repeat(43); // Fixture-only server-issued confirmation.
const impact = (action = 'update', revision = 1) => ({
  impactRevision: token, sourceID: source().id, sourceRevision: revision, action, complete: 1,
  counts: { draft: 0, activeRelease: 0, historicalRelease: 0 }, restrictedCount: 0,
  references: [], nextOffset: 0, expiresAt: 9999999999999,
});
const stream = (revision = 1, description = '', activeRelease = 0) => ({
  id: '9007199254740995', revision, document: { name: 'orders-stream', model: 'program', description,
    script: { sdkVersion: 'tier0-stream/v2', code: 'module.exports=api=>{};', timeoutMs: 5000 },
    sources: [{ alias: 'orders', sourceId: source().id, configRevision: 1, resources: [], acquisition: {} }],
    entries: [] },
  status: activeRelease ? 'active' : 'draft', activeRelease, createdAt: 1, updatedAt: 1,
});
const collection = (revision = 1) => ({ kind: 'collection', id: 'devices', revision,
  data: { schemaVersion: 1, name: 'devices', recordSchema: { type: 'object', properties: {
    name: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['name', 'enabled'] } } });
const record = (revision = 1, name = 'pump') => ({ id: 'device-1', collectionId: 'devices', revision,
  data: { name, enabled: true }, createdAt: 1, updatedAt: 1 });
const records = (...items: unknown[]) => ({ items, pageInfo: { hasMore: false } });

describe('Skill examples over localhost HTTP (not a live Tier0 deployment)', () => {
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
  it('executes unreferenced Source create, rename and delete in three requests using canonical receipts', async () => {
    steps = [
      { path: 'sources/documents/create', check: b => expect(b).toMatchObject({
        dryRun: false, idempotencyKey: 'create-source', document: source().document }), data: source() },
      { path: 'sources/documents/update', check: b => expect(b).toEqual({
        id: source().id, dryRun: false, expectedRevision: 1, idempotencyKey: 'rename-source',
        patch: { name: 'renamed' } }), data: source(2, 'renamed') },
      { path: 'sources/delete', check: b => expect(b.items).toEqual([
        { id: source().id, expectedRevision: 2 }]), data: { ...outcome(), results: [
        { opId: 'item-1', action: 'meta.archive', kind: 'source', id: source().id, revision: 2, status: 'deleted' },
      ] } },
    ];
    const created = await example('source', 'create').createHttpSource('https://fixture.invalid', 'orders', 'create-source', client);
    expect(created.current).toEqual(source());
    const changed = await example('source', 'update').renameSource(created.current.id, created.current.revision, 'renamed', 'rename-source', client);
    expect(changed.current).toEqual(source(2, 'renamed'));
    const deleted = await example('source', 'delete').deleteSource(changed.current.id,
      changed.current.revision, 'delete-source', client);
    expect(deleted.state).toBe('archived');
    expect(calls).toHaveLength(3);
    finished();
  });

  it('creates an authenticated Source in one request and returns the canonical document', async () => {
    steps = [{ path: 'sources/documents/create', check: b => expect(b).toMatchObject({
      dryRun: false, idempotencyKey: 'create-authenticated',
      credentials: { method: 'GET', kind: 'bearer', material: { token: 'fixture-only' } },
    }), data: source() }];
    const created = await example('source', 'create', 1).createAuthenticatedHttpSource(
      'https://fixture.invalid', 'orders', 'fixture-only', 'create-authenticated', client);
    expect(created.current).toEqual(source());
    expect(created.receipt.data).toEqual(source());
    expect(calls).toHaveLength(1);
    finished();
  });

  it('keeps Source impact review separate from explicitly confirming a referenced rename', async () => {
    steps = [{ path: 'sources/impact', check: b => expect(b).toMatchObject({
      id: source().id, expectedRevision: 1, action: 'update', patch: { name: 'renamed' },
    }), data: { ...impact(), counts: { draft: 1, activeRelease: 0, historicalRelease: 0 } } }];
    const workflow = example('source', 'update', 1);
    const plan = await workflow.prepareSourceRename(source().id, 1, 'renamed', client);
    expect(plan.impact.counts.draft).toBe(1);
    expect(calls).toHaveLength(1);
    finished();
    steps = [{ path: 'sources/documents/update', check: b => expect(b).toEqual({
      id: source().id, expectedRevision: 1, patch: { name: 'renamed' },
      confirmedImpactRevision: token, dryRun: false, idempotencyKey: 'reviewed-rename',
    }), data: source(2, 'renamed') }];
    const changed = await workflow.commitSourceRename(plan, 'reviewed-rename', client);
    expect(changed.current).toEqual(source(2, 'renamed'));
    expect(calls).toHaveLength(2);
    finished();
  });

  it('sets an unreferenced Source desired state in one request without asserting runtime health', async () => {
    steps = [{ path: 'sources/state/update', check: b => expect(b.items).toEqual([
      { id: source().id, expectedRevision: 1, desiredState: 'enabled' },
    ]), data: outcome() }];
    const changed = await example('source', 'state').setSourceState(source().id, 1, 'enabled', 'enable-source', client);
    expect(changed.state).toBe('committed');
    expect(changed).not.toHaveProperty('current');
    expect(calls).toHaveLength(1);
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
      config: { configVersion: 2, role: 'server', endpoint: 'http://managed', options: {} } };
    steps = [{ path: 'sources/documents/create', check: body => expect(body).toEqual({
      dryRun: false, idempotencyKey: 'create-server', document: serverDocument,
    }), data: { ...current, document: serverDocument } }];
    const created = await example('source', 'create', 2).createHttpServerSource('orders-in', 'create-server', client);
    expect(created.current.document).toEqual(serverDocument);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('uses the public default Client role when the HTTP config omits role', async () => {
    const current = source();
    const { role: _role, ...config } = current.document.config;
    steps = [
      { path: 'sources/documents/get', data: { ...current, document: { ...current.document, config } } },
      { path: 'streams/documents/create', check: body => {
        expect(body.program.sourceBindings[0].sourceId).toBe(current.id);
        expect(body.program.script).toContain('upstream.request');
      }, data: stream() },
    ];
    await example('stream', 'create').createHttpStream(current.id, 'orders-stream', 'create-stream', client);
    expect(calls).toHaveLength(2);
    finished();
  });

  it.each([
    ['http-api', 'server'], ['http_push', undefined], ['http', undefined],
  ])('rejects %s/%s before creating an active-request Stream', async (protocol, role) => {
    const current = source();
    steps = [{ path: 'sources/documents/get', data: { ...current,
      document: { ...current.document, protocol, config: { ...current.document.config, role } } } }];
    await expect(example('stream', 'create').createHttpStream(
      current.id, 'orders-stream', 'create-stream', client,
    )).rejects.toThrow('此主动请求示例需要 HTTP API Client Source');
    expect(calls).toHaveLength(1);
    finished();
  });

  it('executes Stream Source binding, full-document update, deploy, guarded disable and deletion', async () => {
    steps = [
      { path: 'sources/documents/get', data: source() },
      { path: 'streams/documents/create', check: b => {
        expect(b.program.sourceBindings).toEqual([{ sourceId: source().id, configRevision: 1, acquisition: {} }]);
        expect(b.program.script).toContain('api.sources.use');
        expect(b.program.script).toContain('api.stream.every');
        expect(b.program.script).not.toMatch(/\.onTimer\(|\.onEvent\(|\.secrets\(|\bcontrol\s*:/);
      }, data: stream() },
      { path: 'streams/documents/get', data: stream() },
      { path: 'streams/documents/update', check: b => expect(b).toMatchObject({
        expectedRevision: 1, document: { ...stream().document, description: 'updated' } }), data: stream(2, 'updated') },
      { path: 'streams/program/deploy', check: b => expect(b).toMatchObject({
        expectedRevision: 2, expectedSourceRevision: 1, dryRun: false }),
        data: { id: stream().id, revision: 2, activeVersion: '9007199254740997', activeRelease: 1 } },
      { path: 'streams/documents/get', data: stream(2, 'updated', 1) },
      { path: 'streams/documents/disable', check: b => expect(b).toMatchObject({
        expectedRevision: 2, expectedActiveRelease: 1 }), data: { id: stream().id, revision: 3, status: 'disabled', activeRelease: 0 } },
      { path: 'streams/documents/get', data: stream(3, 'updated') },
      { path: 'streams/documents/get', data: stream(3, 'updated') },
      { path: 'streams/program/delete', check: b => expect(b.expectedRevision).toBe(3),
        data: { id: stream().id, revision: 3, deleted: true } },
      { path: 'streams/program/list', data: page([stream(3, 'updated')]) },
    ];
    const created = await example('stream', 'create').createHttpStream(source().id, 'orders-stream', 'create-stream', client);
    const id = created.current.id;
    const updated = await example('stream', 'update').updateStreamDescription(id, 'updated', 'update-stream', client);
    const deployed = await example('stream', 'deploy').deployStream(updated.current, 'deploy-stream', client);
    expect(deployed.release).toBe(1);
    await example('stream', 'deploy').disableStream(id, 'disable-stream', client);
    const deleted = await example('stream', 'delete').deleteStream(id, 'delete-stream', client);
    expect(deleted.archived.id).toBe(id);
    finished();
  });

  it('executes metadata and Record CRUD, Schema replacement, soft delete and restore', async () => {
    steps = [
      { path: 'metadata', data: outcome('validated') },
      { path: 'metadata', check: b => expect(b.data.recordSchema.required).toEqual(['name', 'enabled']), data: outcome() },
      { path: 'metadata:find', data: { items: [collection()] } },
      { path: 'collections/devices/records', check: b => expect(b.returnDocument).toBe('after'),
        data: { insertedId: 'device-1', value: record(), status: 'committed', replayed: false } },
      { path: 'collections/devices/records:find', data: records(record()) },
      { path: 'collections/devices/records:updateOne', check: b => expect(b).toMatchObject({
        filter: { _id: 'device-1' }, expectedRevision: 1, update: { $set: { name: 'pump-2' } }, upsert: false }),
        data: { status: 'committed', matchedCount: 1, modifiedCount: 1, replayed: false } },
      { path: 'collections/devices/records:find', data: records(record(2, 'pump-2')) },
      { path: 'metadata:find', data: { items: [collection()] } },
      { path: 'metadata:updateOne', check: b => {
        expect(b.update.$set.recordSchema.properties.location).toEqual({ type: 'string' });
        expect(b.update.$set.recordSchema.required).toEqual(['name', 'enabled']);
        expect(b.update.$set).not.toHaveProperty('sampleSchema');
      }, data: outcome('validated') },
      { path: 'metadata:updateOne', data: outcome() },
      { path: 'metadata:find', data: { items: [collection(2)] } },
      { path: 'metadata:updateOne', check: b => expect(b).toMatchObject({
        kind: 'collection', filter: { _id: 'devices' }, expectedRevision: 2,
        update: { $set: { name: 'renamed' } }, returnDocument: 'after', upsert: false,
      }), data: { ...outcome(), value: { ...collection(3), data: { ...collection().data, name: 'renamed' } } } },
      { path: 'collections/devices/records:find', data: records(record(2, 'pump-2')) },
      { path: 'collections/devices/records:deleteOne', check: b => expect(b.expectedRevision).toBe(2),
        data: { status: 'committed', deletedCount: 1, replayed: false } },
      { path: 'collections/devices/records:find', data: records() },
      { path: 'collections/devices/records:restore', data: { status: 'committed', restoredCount: 1, restoredIds: ['device-1'], replayed: false } },
      { path: 'collections/devices/records:find', data: records(record(4, 'pump-2')) },
      { path: 'metadata:find', data: { items: [collection(3)] } },
      { path: 'metadata:deleteOne', check: b => expect(b.expectedRevision).toBe(3), data: { ...outcome(), deletedCount: 1 } },
      { path: 'metadata:find', check: b => expect(b.state).toBe('deleted'), data: { items: [{ ...collection(4), deletedAt: 1 }] } },
      { path: 'metadata:find', check: b => expect(b.state).toBe('deleted'), data: { items: [{ ...collection(4), deletedAt: 1 }] } },
      { path: 'metadata:restore', check: b => expect(b.items[0].expectedRevision).toBe(4), data: { ...outcome(), restoredCount: 1 } },
      { path: 'metadata:find', data: { items: [collection(5)] } },
    ];
    await example('uns', 'create').createDeviceCollection('devices', 'devices', 'create-collection', client);
    const inserted = await example('uns', 'create', 1).insertDevice('devices', 'device-1', 'pump', 'insert-record', client);
    expect(inserted.created).toEqual(record());
    await example('uns', 'update', 2).renameDevice('devices', 'device-1', 'pump-2', 'update-record', client);
    const schema = { ...collection().data.recordSchema, properties: { ...collection().data.recordSchema.properties, location: { type: 'string' } } };
    await example('uns', 'update', 1).replaceRecordSchema('devices', schema, 'schema-change', client);
    await example('uns', 'update').renameCollection('devices', 'renamed', 'rename-collection', client);
    await example('uns', 'delete').deleteDevice('devices', 'device-1', 'delete-record', client);
    await example('uns', 'restore').restoreDevice('devices', 'device-1', 'restore-record', client);
    await example('uns', 'delete', 1).deleteCollection('devices', 'delete-collection', client);
    await example('uns', 'restore').restoreCollection('devices', 'restore-collection', client);
    finished();
  });

  it('does not treat an unconfirmed metadata mutation as committed or perform dependent reads', async () => {
    steps = [
      { path: 'metadata', data: outcome('validated') },
      { path: 'metadata', data: outcome('unconfirmed') },
    ];
    const result = await example('uns', 'create').createDeviceCollection('devices', 'devices', 'create', client);
    expect(result.state).toBe('unconfirmed');
    expect(result.receipt.data.status).toBe('unconfirmed');
    finished();
  });

  it('does not retry a Source mutation after an unknown transport result', async () => {
    steps = [{ path: 'sources/delete', raw: 'truncated response' }];
    await expect(example('source', 'delete').deleteSource(source().id, 1, 'delete', client, token))
      .rejects.toBeInstanceOf(sdk.UnsV2OutcomeUnknownError);
    expect(calls).toHaveLength(1);
    finished();
  });

  it('does not insert when updating an absent Record', async () => {
    steps = [{ path: 'collections/devices/records:find', data: records() }];
    await expect(example('uns', 'update', 2).renameDevice('devices', 'missing', 'new', 'rename', client))
      .rejects.toThrow('记录不存在');
    expect(calls).toHaveLength(1);
    finished();
  });

  it('sends the migrated notification example with inbox type, explicit mode and v2 App identity', async () => {
    vi.stubEnv('APP_ID', 'da6aa4b6-1a8f-43b7-86ed-73818fe22550');
    steps = [
      { path: '/openapi/v2/notifications/send', check: body => {
        expect(body).toMatchObject({ recipientUserId: '9007199254740993', type: 'inbox',
          mode: 'test', idempotencyKey: 'work-order-event-v1', channels: ['web', 'mobile'],
          sender: { type: 'app', id: 'da6aa4b6-1a8f-43b7-86ed-73818fe22550' } });
        expect(body.sender).not.toHaveProperty('meta');
        expect(body.sender).not.toHaveProperty('name');
      }, raw: JSON.stringify({ messageId: '9007199254740997', status: 'accepted', createdAt: '2026-10-22T00:00:00Z' }) },
      { path: '/openapi/v2/notifications/get', check: body => expect(body.messageId).toBe('9007199254740997'),
        raw: JSON.stringify({ messageId: '9007199254740997', type: 'inbox', status: 'accepted', createdAt: '2026-10-22T00:00:00Z' }) },
    ];
    try {
      const sent = await example('notifications', 'send').sendCompletedOrder(
        '9007199254740993', 'work-order', 'work-order-event-v1', 'test', client);
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
