import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createDataClient,
  DataError,
  defineCollection,
  isCollectionDefinition,
  isCollectionIdReference,
  isExternalAliasReference,
  type SubscriptionEvent,
} from '../../src/data/index.js';

const owned = defineCollection({
  alias: 'orders',
  name: '工单',
  schema: z.object({ title: z.string() }),
  indexes: [{ path: 'title', unique: true }],
  seed: [{ _id: 'seed', title: 'Seed' }],
});

const silent = { info() {}, warn() {}, error() {} };

interface AppContextItem {
  alias: string;
  collectionId: string;
  permissions: string[];
  ownerAppId?: string;
}

function appContextPayload(collections: AppContextItem[]) {
  return {
    appId: 'app-1',
    name: 'Test App',
    revision: 1,
    dataState: 'ready',
    platformPermissions: [],
    limits: {},
    collections: collections.map((item) => ({
      alias: item.alias,
      collectionId: item.collectionId,
      permissions: item.permissions,
      ownerAppId: item.ownerAppId,
      recordSchema: { type: 'object', properties: {} },
      revision: 1,
      indexStatus: [],
      ttl: null,
      name: item.alias,
      directoryPath: [],
    })),
  };
}

function staleError(reason: 'COLLECTION_NOT_GRANTED' | 'COLLECTION_NOT_FOUND', collectionId?: string) {
  return new Response(
    JSON.stringify({
      code: 403,
      msg: reason,
      requestId: 'req-stale',
      data: { reason, ...(collectionId ? { collectionId } : {}) },
      error: { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } },
    }),
    { status: 403 },
  );
}

function fixture(
  reply: (path: string, body: Record<string, unknown>, url: URL) => unknown,
  declarations = [owned],
) {
  const sent: { path: string; body: Record<string, unknown>; url: URL }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    sent.push({ path, body, url });
    const data = await reply(path, body, url);
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'ext-test', data }), { status: 200 });
  };
  return {
    data: createDataClient({
      collections: declarations,
      apiHost: 'https://test.invalid',
      apiKey: 'test-app-key',
      fetch,
      logger: silent,
    }),
    sent,
  };
}

describe('external { alias } collection references', () => {
  it('distinguishes owned definitions, external alias references, and collectionId references', () => {
    const extRef = { alias: 'equipment_master', schema: z.object({ code: z.string() }) };
    const idRef = { collectionId: 'col-1' };

    expect(isCollectionDefinition(owned)).toBe(true);
    expect(isExternalAliasReference(owned)).toBe(false);
    expect(isCollectionIdReference(owned)).toBe(false);

    expect(isCollectionDefinition(extRef)).toBe(false);
    expect(isExternalAliasReference(extRef)).toBe(true);
    expect(isCollectionIdReference(extRef)).toBe(false);

    expect(isCollectionDefinition(idRef)).toBe(false);
    expect(isExternalAliasReference(idRef)).toBe(false);
    expect(isCollectionIdReference(idRef)).toBe(true);
  });

  it('rejects external alias collisions with declared owned collections (case-insensitive) and malformed references', () => {
    const data = createDataClient({ collections: [owned] });
    expect(() => data.collection({ alias: 'orders' })).toThrow(/conflicts with a declared collection/);
    expect(() => data.collection({ alias: 'ORDERS' })).toThrow(/conflicts with a declared collection/);
    expect(() => data.collection({ alias: '' })).toThrow(/must match/);
    expect(() => data.collection({ alias: '1bad' })).toThrow(/must match/);
    expect(() => data.collection({ collectionId: 'c-1', alias: 'ext' } as never)).toThrow(/not both/);
  });

  it('resolves external { alias } via appContext with single-flight caching, local schema validation, and zero ensure calls', async () => {
    let contextCalls = 0;
    const { data, sent } = fixture(async (path) => {
      if (path.endsWith('/uns/app/context')) {
        contextCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return appContextPayload([
          { alias: 'Equipment_Master', collectionId: 'c-eq-1', permissions: ['record:read', 'record:write'] },
        ]);
      }
      if (path.endsWith('/collections/c-eq-1/records:find')) {
        return { items: [{ id: 'e-1', data: { code: 'EQ-01' }, revision: 1, createdAt: 1, updatedAt: 1 }], pageInfo: { hasMore: false } };
      }
      if (path.endsWith('/collections/c-eq-1/records')) {
        return { insertedId: 'e-2', status: 'committed' };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const equipment = data.collection({
      alias: 'equipment_master',
      schema: z.object({ code: z.string() }),
    });
    expect(equipment.alias).toBe('equipment_master');

    // Concurrent calls share one single-flight dataAppContext request.
    const [a, b, c] = await Promise.all([
      equipment.findOne({}),
      equipment.findOne({}),
      data.resolveCollectionId({ alias: 'EQUIPMENT_MASTER' }),
    ]);
    expect(a).toMatchObject({ _id: 'e-1', code: 'EQ-01' });
    expect(b).toMatchObject({ _id: 'e-1', code: 'EQ-01' });
    expect(c).toBe('c-eq-1');
    expect(contextCalls).toBe(1);

    // Local write validation applies without calling ensure.
    await equipment.insertOne({ code: 'EQ-02' });
    await expect(equipment.insertOne({ code: 123 as never })).rejects.toBeInstanceOf(z.ZodError);
    expect(sent.filter((item) => item.path.endsWith('/ensure'))).toHaveLength(0);
    expect(contextCalls).toBe(1);
  });

  it('throws deterministic EXTERNAL_COLLECTION_UNBOUND (503) when unbound and never calls ensure', async () => {
    const { data, sent } = fixture((path) => {
      if (path.endsWith('/uns/app/context')) return appContextPayload([]);
      throw new Error(`Unexpected path: ${path}`);
    });

    const err = await data.collection({ alias: 'missing_ext' }).findOne({}).catch((cause: unknown) => cause);
    expect(err).toBeInstanceOf(DataError);
    expect(err).toMatchObject({
      code: 'EXTERNAL_COLLECTION_UNBOUND',
      status: 503,
      execution: 'notStarted',
      details: { alias: 'missing_ext' },
    });
    expect(sent.map((item) => item.path)).toEqual(['/openapi/v2/uns/app/context']);
  });

  it('transparently recovers on hot rebind (COLLECTION_NOT_GRANTED / COLLECTION_NOT_FOUND) and rate-limits refreshes', async () => {
    let contextCalls = 0;
    let currentId = 'c-eq-1';
    const { data, sent } = fixture((path) => {
      if (path.endsWith('/uns/app/context')) {
        contextCalls += 1;
        return appContextPayload([{ alias: 'equipment', collectionId: currentId, permissions: ['record:read'] }]);
      }
      if (path.endsWith('/collections/c-eq-1/records:find')) {
        if (currentId !== 'c-eq-1') return staleError('COLLECTION_NOT_GRANTED', 'c-eq-1');
        return { items: [{ id: 'e-1', data: { source: 'v1' }, revision: 1, createdAt: 1, updatedAt: 1 }], pageInfo: { hasMore: false } };
      }
      if (path.endsWith('/collections/c-eq-2/records:find')) {
        if (currentId !== 'c-eq-2') return staleError('COLLECTION_NOT_FOUND', 'c-eq-2');
        return { items: [{ id: 'e-2', data: { source: 'v2' }, revision: 1, createdAt: 1, updatedAt: 1 }], pageInfo: { hasMore: false } };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const equipment = data.collection<{ source: string }>({ alias: 'equipment' });
    expect(await equipment.findOne({})).toMatchObject({ _id: 'e-1', source: 'v1' });
    expect(contextCalls).toBe(1);

    // Admin rebinds alias -> c-eq-2 without restarting the App.
    currentId = 'c-eq-2';
    expect(await equipment.findOne({})).toMatchObject({ _id: 'e-2', source: 'v2' });
    expect(contextCalls).toBe(2);

    // Second stale error within the 30s throttle window does not hammer appContext.
    currentId = 'c-eq-3';
    await expect(equipment.findOne({})).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'COLLECTION_NOT_FOUND' });
    expect(contextCalls).toBe(2);
    expect(sent.filter((item) => item.path.endsWith('/ensure'))).toHaveLength(0);
  });

  it('converts revoked/deleted/owner-trashed external collection into EXTERNAL_COLLECTION_UNBOUND (503) after refresh', async () => {
    let bound = true;
    const { data, sent } = fixture((path) => {
      if (path.endsWith('/uns/app/context')) {
        return appContextPayload(bound ? [{ alias: 'equipment', collectionId: 'c-eq-1', permissions: ['record:read'] }] : []);
      }
      if (path.endsWith('/collections/c-eq-1/records:find')) {
        if (!bound) return staleError('COLLECTION_NOT_GRANTED', 'c-eq-1');
        return { items: [], pageInfo: { hasMore: false } };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const equipment = data.collection({ alias: 'equipment' });
    await equipment.findOne({});
    bound = false;

    await expect(equipment.findOne({})).rejects.toMatchObject({
      code: 'EXTERNAL_COLLECTION_UNBOUND',
      status: 503,
      details: { alias: 'equipment' },
    });
    expect(sent.filter((item) => item.path.endsWith('/ensure'))).toHaveLength(0);
  });

  it('preserves FORBIDDEN when a bound read-only external collection refuses a write', async () => {
    const { data } = fixture((path) => {
      if (path.endsWith('/uns/app/context')) {
        return appContextPayload([{ alias: 'equipment', collectionId: 'c-eq-1', permissions: ['record:read'] }]);
      }
      if (path.endsWith('/collections/c-eq-1/records')) {
        return staleError('COLLECTION_NOT_GRANTED', 'c-eq-1');
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(data.collection({ alias: 'equipment' }).insertOne({ code: 'X' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      reason: 'COLLECTION_NOT_GRANTED',
    });
  });

  it('recovers external { alias } targets inside aggregate $lookup.from and $unionWith.from', async () => {
    let extId = 'c-ext-1';
    const { data, sent } = fixture((path, body) => {
      if (path.endsWith('/uns/app/collections/ensure')) {
        return { appId: 'app-1', results: [{ alias: 'orders', collectionId: 'c-orders', revision: 1, status: 'unchanged' }] };
      }
      if (path.endsWith('/uns/app/context')) {
        return appContextPayload([{ alias: 'equipment', collectionId: extId, permissions: ['record:read'] }]);
      }
      if (path.endsWith('/collections/c-orders/records:aggregate')) {
        const pipeline = body.pipeline as Record<string, Record<string, unknown>>[];
        const lookupId = pipeline[0]?.$lookup?.collectionId;
        const unionId = pipeline[1]?.$unionWith?.collectionId;
        if (lookupId !== extId || unionId !== extId) {
          return staleError('COLLECTION_NOT_GRANTED', String(lookupId));
        }
        return { items: [{ _id: 'o-1', joined: extId }], pageInfo: { hasMore: false } };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const pipeline = [
      { $lookup: { from: { alias: 'equipment' }, localField: 'eqId', foreignField: '_id', as: 'eq' } },
      { $unionWith: { from: { alias: 'equipment' } } },
    ];
    expect(await data.collection(owned).aggregate(pipeline).toArray()).toEqual([{ _id: 'o-1', joined: 'c-ext-1' }]);

    extId = 'c-ext-2';
    expect(await data.collection(owned).aggregate(pipeline).toArray()).toEqual([{ _id: 'o-1', joined: 'c-ext-2' }]);
    // Owned collection was ensured only once; only external context refreshed.
    expect(sent.filter((item) => item.path.endsWith('/ensure'))).toHaveLength(1);
    expect(sent.filter((item) => item.path.endsWith('/context'))).toHaveLength(2);
  });

  it('supports external { alias } in queryBatch (including $lookup) and transact with rebind recovery', async () => {
    let extId = 'c-ext-1';
    const { data, sent } = fixture((path, body) => {
      if (path.endsWith('/uns/app/collections/ensure')) {
        return { appId: 'app-1', results: [{ alias: 'orders', collectionId: 'c-orders', revision: 1, status: 'unchanged' }] };
      }
      if (path.endsWith('/uns/app/context')) {
        return appContextPayload([{ alias: 'equipment', collectionId: extId, permissions: ['record:read', 'record:write'] }]);
      }
      if (path.endsWith('records:queryBatch')) {
        const queries = body.queries as { collectionId: string; pipeline?: { $lookup?: { collectionId?: string } }[] }[];
        const lookupId = queries[0]?.pipeline?.[0]?.$lookup?.collectionId;
        if (queries[1]?.collectionId !== extId || lookupId !== extId) {
          return staleError('COLLECTION_NOT_GRANTED', extId === 'c-ext-2' ? 'c-ext-1' : 'c-ext-2');
        }
        return {
          results: {
            joined: { ok: true, data: { items: [{ id: extId }] } },
            extCount: { ok: true, data: { count: 3, capped: false } },
          },
        };
      }
      if (path.endsWith('records:transact')) {
        const items = body.items as { collectionId: string }[];
        if (items[1]?.collectionId !== extId) {
          return staleError('COLLECTION_NOT_GRANTED', items[1]?.collectionId);
        }
        return { status: 'committed', results: [] };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const equipment = data.collection({ alias: 'equipment' });
    const first = await data.queryBatch({
      joined: data.collection(owned).query.aggregate([
        { $lookup: { from: { alias: 'equipment' }, localField: 'eqId', foreignField: '_id', as: 'eq' } },
      ]),
      extCount: equipment.query.count(),
    });
    expect(first).toEqual({ joined: [{ id: 'c-ext-1' }], extCount: { count: 3, capped: false } });

    extId = 'c-ext-2';
    const second = await data.queryBatch({
      joined: data.collection(owned).query.aggregate([
        { $lookup: { from: { alias: 'equipment' }, localField: 'eqId', foreignField: '_id', as: 'eq' } },
      ]),
      extCount: equipment.query.count(),
    });
    expect(second).toEqual({ joined: [{ id: 'c-ext-2' }], extCount: { count: 3, capped: false } });

    await data.transact([
      { opId: 'o1', action: 'record.read', collection: owned, id: 'order-1' },
      { opId: 'e1', action: 'record.read', collection: { alias: 'equipment' }, id: 'eq-1' },
    ]);
    expect(sent.filter((item) => item.path.endsWith('/ensure'))).toHaveLength(1);
  });

  it('exposes resolveCollectionId for owned, collectionId, and external { alias } with refresh support', async () => {
    let extId = 'c-ts-1';
    const { data } = fixture((path) => {
      if (path.endsWith('/uns/app/collections/ensure')) {
        return { appId: 'app-1', results: [{ alias: 'orders', collectionId: 'c-orders', revision: 1, status: 'unchanged' }] };
      }
      if (path.endsWith('/uns/app/context')) {
        return appContextPayload([{ alias: 'telemetry', collectionId: extId, permissions: ['sample:read'] }]);
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    expect(await data.resolveCollectionId(owned)).toBe('c-orders');
    expect(await data.resolveCollectionId('orders')).toBe('c-orders');
    expect(await data.resolveCollectionId({ collectionId: 'raw-id' })).toBe('raw-id');
    expect(await data.resolveCollectionId({ alias: 'telemetry' })).toBe('c-ts-1');

    extId = 'c-ts-2';
    expect(await data.resolveCollectionId({ alias: 'telemetry' })).toBe('c-ts-1');
    expect(await data.resolveCollectionId({ alias: 'telemetry' }, { refresh: true })).toBe('c-ts-2');
    await expect(data.resolveCollectionId({ alias: 'not_bound' })).rejects.toMatchObject({
      code: 'EXTERNAL_COLLECTION_UNBOUND',
      status: 503,
      details: { alias: 'not_bound' },
    });
  });

  it('rejects index readiness checks for external { alias } references', async () => {
    const data = createDataClient({ collections: [owned] });
    const extRef = { alias: 'equipment' };
    expect(() => data.assertIndexesReady([extRef as never])).toThrow(/declarations from this data client/);
    await expect(
      data.transact(
        [{ opId: 'e1', action: 'record.read', collection: extRef, id: '1' }],
        { requireIndexesReady: true },
      ),
    ).rejects.toThrow(/declared collections/);
    await expect(
      data.collection(extRef).updateManyAtomic({}, { $set: { x: 1 } }, { requireIndexesReady: true }),
    ).rejects.toThrow(/declared collection/);
  });

  it('subscribes to external { alias } explicitly, throws EXTERNAL_COLLECTION_UNBOUND if unbound, and refreshes on SCOPE_CHANGED', async () => {
    let extId = 'c-ext-1';
    let streamCount = 0;
    const openedIds: string[][] = [];

    const { data } = fixture((path, _body, url) => {
      if (path.endsWith('/uns/app/context')) {
        return appContextPayload(
          extId ? [{ alias: 'equipment', collectionId: extId, permissions: ['record:read'] }] : [],
        );
      }
      if (path.endsWith('/uns/records:subscribe')) {
        streamCount += 1;
        openedIds.push(url.searchParams.getAll('collectionIds'));
        const frames =
          streamCount === 1
            ? [
                `id: e-1\nevent: change\ndata: ${JSON.stringify({ eventId: 'e-1', collectionId: 'c-ext-1', recordId: 'r-1', revision: 1, change: 'record', occurredAt: 1 })}\n\n`,
                `event: reset\ndata: ${JSON.stringify({ reason: 'SCOPE_CHANGED' })}\n\n`,
              ]
            : [
                `id: e-2\nevent: change\ndata: ${JSON.stringify({ eventId: 'e-2', collectionId: 'c-ext-2', recordId: 'r-2', revision: 1, change: 'record', occurredAt: 2 })}\n\n`,
              ];
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(frame));
            controller.close();
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(
      data.subscribe({ collections: [{ alias: 'unbound_ext' }] })[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'EXTERNAL_COLLECTION_UNBOUND', status: 503, details: { alias: 'unbound_ext' } });

    const events: SubscriptionEvent[] = [];
    for await (const event of data.subscribe({ collections: [{ alias: 'equipment' }] })) {
      events.push(event);
      if (event.type === 'reset') extId = 'c-ext-2';
      if (events.length === 3) break;
    }
    expect(events).toEqual([
      { type: 'change', eventId: 'e-1', collection: 'equipment', collectionId: 'c-ext-1', recordId: 'r-1', revision: 1, change: 'record', occurredAt: 1 },
      { type: 'reset', reason: 'SCOPE_CHANGED' },
      { type: 'change', eventId: 'e-2', collection: 'equipment', collectionId: 'c-ext-2', recordId: 'r-2', revision: 1, change: 'record', occurredAt: 2 },
    ]);
    expect(openedIds).toEqual([['c-ext-1'], ['c-ext-2']]);
  });

  it('default subscribe skips unbound/sample-only external collections, includes bound readable ones, and drops revoked ones without blocking owned', async () => {
    let extBound = true;
    let streamCount = 0;
    const openedIds: string[][] = [];

    const { data } = fixture((path, _body, url) => {
      if (path.endsWith('/uns/app/collections/ensure')) {
        return { appId: 'app-1', results: [{ alias: 'orders', collectionId: 'c-orders', revision: 1, status: 'unchanged' }] };
      }
      if (path.endsWith('/uns/app/context')) {
        return appContextPayload([
          ...(extBound ? [{ alias: 'equipment', collectionId: 'c-ext-1', permissions: ['record:read'] }] : []),
          { alias: 'telemetry_only', collectionId: 'c-sample-1', permissions: ['sample:read'] },
        ]);
      }
      if (path.endsWith('/uns/records:subscribe')) {
        streamCount += 1;
        openedIds.push(url.searchParams.getAll('collectionIds'));
        if (streamCount === 1) {
          extBound = false;
          return staleError('COLLECTION_NOT_GRANTED', 'c-ext-1');
        }
        const frame = `id: e-9\nevent: change\ndata: ${JSON.stringify({ eventId: 'e-9', collectionId: 'c-orders', recordId: 'o-1', revision: 1, change: 'record', occurredAt: 9 })}\n\n`;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frame));
            controller.close();
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    // Reference both a bound external alias, an unbound alias, and a sample-only alias.
    data.collection({ alias: 'equipment' });
    data.collection({ alias: 'deferred_ext' });
    data.collection({ alias: 'telemetry_only' });

    const events: SubscriptionEvent[] = [];
    for await (const event of data.subscribe()) {
      events.push(event);
      if (events.length === 2) break;
    }
    expect(events).toEqual([
      { type: 'reset', reason: 'SCOPE_CHANGED' },
      { type: 'change', eventId: 'e-9', collection: 'orders', collectionId: 'c-orders', recordId: 'o-1', revision: 1, change: 'record', occurredAt: 9 },
    ]);
    // First attempt included owned + bound readable external (skipping deferred_ext & telemetry_only);
    // second attempt dropped revoked c-ext-1 and kept streaming c-orders!
    expect(openedIds).toEqual([['c-orders', 'c-ext-1'], ['c-orders']]);
  });
});
