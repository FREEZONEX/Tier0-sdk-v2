import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindUnsV2NewRequests, createUnsV2Client, listUnsV2Methods, listUnsV2Operations,
  UNS_V2_OPERATIONS, UNS_V2_OPERATION_GROUPS, type UnsV2OperationName } from '../src/index.js';
import { HttpClient } from '../src/openapi/client.js';

const manifest = JSON.parse(readFileSync(new URL('../contracts/uns-v2/manifest.json', import.meta.url), 'utf8'));

describe('manifest-backed recommended API surface', () => {
  it('derives complete, recommended and starter inventories without losing compatibility routes', () => {
    const all = manifest.operations.filter((operation: { coreOnly?: boolean }) => !operation.coreOnly);
    expect(listUnsV2Operations('all').map(operation => operation.name)).toEqual(all.map((operation: { name: string }) => operation.name));
    expect(listUnsV2Operations('all')).toHaveLength(107);
    expect(listUnsV2Operations()).toHaveLength(86);
    expect(listUnsV2Operations('starter')).toHaveLength(15);
    expect(listUnsV2Operations().every(operation => !operation.compatibility)).toBe(true);
    for (const operation of listUnsV2Operations('all')) {
      const original = all.find((item: { name: string }) => item.name === operation.name);
      expect(operation).toMatchObject({ audience: original.audience, starter: original.starter, compatibility: original.compatibility ?? null });
      expect(UNS_V2_OPERATION_GROUPS.all[operation.audience]).toContain(operation.name);
    }
    expect(listUnsV2Operations('recommended', 'platform').every(operation => operation.audience === 'platform')).toBe(true);
    expect(UNS_V2_OPERATIONS.recordFindOneAndUpdate.compatibility).toEqual({ replacement: 'recordUpdateOne', strategy: 'returnDocument' });
  });

  it('lists SSE subscriptions but never exposes or sends them as a POST method', async () => {
    let calls = 0;
    const http = new HttpClient({ apiHost: 'https://fixture.invalid', fetch: async () => { calls++; return new Response('{}'); } });
    const raw = createUnsV2Client(() => http);
    expect(listUnsV2Operations('starter').find(operation => operation.name === 'recordSubscribe')).toMatchObject({ method: 'GET', transport: 'sse' });
    expect(listUnsV2Methods('all')).not.toContain('recordSubscribe');
    expect('recordSubscribe' in raw).toBe(false);
    await expect(raw.call('recordSubscribe' as UnsV2OperationName, {} as never)).rejects.toThrow('SSE');
    expect(calls).toBe(0);
  });
});

describe('explicit new-request conveniences', () => {
  function fixture() {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const config = { apiHost: 'https://fixture.invalid', fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, body: JSON.parse(String(init?.body)) });
      const data = path === '/openapi/v2/uns/metadata:aggregate' ? { items: [{ value: 'Metadata' }, { value: null }], pageInfo: { hasMore: false } }
        : path.endsWith(':find') ? { items: [], pageInfo: { hasMore: false } }
        : path.endsWith(':aggregate') ? { items: [{ _id: 'OPEN' }, { _id: null }], pageInfo: { hasMore: true, nextPage: 3 } }
        : { insertedCount: 2, insertedIds: { 0: 'a', 1: 'b' }, status: 'committed', replayed: false };
      return new Response(JSON.stringify({ code: 200, msg: '', requestId: 'new-intent', data }));
    } };
    const raw = createUnsV2Client(() => new HttpClient(config), config);
    return { calls, raw, fresh: bindUnsV2NewRequests(raw) };
  }

  it('keeps legacy insert requests intact and sends only explicit new intents through bulk', async () => {
    const { calls, raw, fresh } = fixture();
    const request = { collectionId: 'orders', idempotencyKey: 'original-intent', dryRun: true, documents: [{ id: 'a', data: { name: 'A' } }, { id: 'b', data: { name: 'B' } }] };
    await raw.recordInsertMany(request);
    expect(calls[0]).toEqual({ path: '/openapi/v2/uns/collections/orders/records:insertMany', body: request });
    const result = await fresh.recordInsertMany({ ...request, idempotencyKey: 'new-intent' });
    expect(calls[1]).toEqual({ path: '/openapi/v2/uns/collections/orders/records:bulkWrite', body: {
      collectionId: 'orders', idempotencyKey: 'new-intent', dryRun: true, atomic: false, ordered: true,
      operations: request.documents.map(document => ({ insertOne: document })),
    } });
    expect(result.data.insertedIds).toEqual({ 0: 'a', 1: 'b' });
    await fresh.metadataInsertMany({ kind: 'directory', dryRun: false, idempotencyKey: 'metadata-new', documents: [{ id: 'a', data: { name: 'A' } }] });
    expect(calls[2]).toEqual({ path: '/openapi/v2/uns/metadata:bulkWrite', body: {
      kind: 'directory', dryRun: false, idempotencyKey: 'metadata-new', atomic: true,
      operations: [{ insertOne: { id: 'a', data: { name: 'A' } } }],
    } });
  });

  it('maps canonical query results while preserving filters, state and pagination', async () => {
    const { calls, fresh } = fixture();
    expect((await fresh.metadataFindOne({ kind: 'collection', filter: { _id: 'missing' }, state: 'deleted' })).data.value).toBeNull();
    expect(calls[0].body).toEqual({ kind: 'collection', filter: { _id: 'missing' }, state: 'deleted', limit: 1 });
    const result = await fresh.recordDistinct({ collectionId: 'orders', field: 'status', filter: { enabled: true }, page: { mode: 'offset', page: 2, size: 2 } });
    expect(result.data).toEqual({ values: ['OPEN', null], pageInfo: { hasMore: true, nextPage: 3 } });
    expect(calls[1].body).toEqual({ collectionId: 'orders', page: { mode: 'offset', page: 2, size: 2 }, pipeline: [{ $match: { enabled: true } }, { $group: { _id: '$status' } }] });
    const metadata = await fresh.metadataDistinct({ kind: 'collection', state: 'all', field: 'name', filter: { parentId: 'folder' }, limit: 2 });
    expect(calls[2].body).toEqual({ kind: 'collection', state: 'all', filter: { parentId: 'folder' }, limit: 2, pipeline: [{ $distinct: 'name' }] });
    expect(metadata.data).toEqual({ values: ['Metadata', null], pageInfo: { hasMore: false } });
    await fresh.recordDistinct({ collectionId: 'orders', field: 'status', limit: 2 });
    expect(calls[3].body).toEqual({ collectionId: 'orders', limit: 2, pipeline: [{ $match: {} }, { $group: { _id: '$status' } }] });
  });
});
