import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, DataError, defineCollection, runWithRequestContext, type SubscriptionEvent } from '../../src/data/index.js';

const owned = defineCollection({ alias: 'orders', name: '工单', schema: z.object({ title: z.string() }), seed: [{ _id: 'seed', title: 'Seed' }] });
const shared = { collectionId: 'existing-devices' };
const record = { id: 'device-1', data: { title: 'Pump' }, revision: 1, createdAt: 1, updatedAt: 1 };
const silent = { info() {}, warn() {}, error() {} };

function fixture(reply: (path: string, body: Record<string, unknown>) => unknown, declarations = [owned]) {
  const sent: { path: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    sent.push({ path, body, headers: new Headers(init?.headers) });
    const data = reply(path, body);
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'reference-test', data }), { status: 200 });
  };
  return { data: createDataClient({ collections: declarations, apiHost: 'https://test.invalid', apiKey: 'test-app-key', fetch, logger: silent }), sent };
}

function denied() {
  return new Response(JSON.stringify({
    code: 403, msg: 'Collection not granted', requestId: 'denied',
    data: { reason: 'COLLECTION_NOT_GRANTED', collectionId: shared.collectionId },
    error: { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } },
  }), { status: 403 });
}

describe('existing collection references', () => {
  it('reads and writes by ID without initializing unrelated owned declarations or changing grants', async () => {
    const { data, sent } = fixture(path => {
      if (path.endsWith('records:find')) return { items: [record], pageInfo: { hasMore: false } };
      if (path.endsWith('/records')) return { insertedId: 'new-record', status: 'committed' };
      if (path.endsWith('records:updateOne')) return { matchedCount: 1, modifiedCount: 1 };
      throw new Error(`Unexpected request: ${path}`);
    });
    const devices = data.collection<{ title: string }>(shared);
    await runWithRequestContext(new Headers({ 'X-Tier0-App-Data-Subject': 'h.employee.s' }), async () => {
      expect(await devices.findOne({})).toMatchObject({ _id: 'device-1', title: 'Pump' });
      await devices.insertOne({ title: 'Valve' });
      await devices.updateOne({ _id: 'device-1' }, { $set: { title: 'Updated' } });
    });
    expect(sent).toHaveLength(3);
    for (const request of sent) {
      expect(request.body.collectionId).toBe(shared.collectionId);
      expect(request.path).toContain(`/collections/${shared.collectionId}/records`);
      expect(request.headers.get('x-tier0-app-data-subject')).toBe('h.employee.s');
    }
  });

  it('validates an optional local schema without creating or modifying storage', async () => {
    const { data, sent } = fixture(() => ({ insertedId: 'device-1', status: 'committed' }));
    const devices = data.collection({ ...shared, schema: z.object({ title: z.string(), qty: z.number().int() }) });
    await devices.insertOne({ title: 'Pump', qty: 1 });
    expect(sent[0].body.data).toEqual({ title: 'Pump', qty: 1 });
    await expect(devices.updateOne({}, { $set: { qty: 'invalid' } })).rejects.toBeInstanceOf(z.ZodError);
    await expect(data.collection(shared).updateOne({}, { $set: { '_meta.revision': 3 } })).rejects.toBeInstanceOf(z.ZodError);
    expect(sent).toHaveLength(1);
  });

  it('supports reference-only batch reads and transactions without an ensure', async () => {
    const { data, sent } = fixture(path => {
      if (path.endsWith('records:queryBatch')) return { results: { count: { ok: true, data: { count: 2, capped: false } } } };
      if (path.endsWith('records:transact')) return { status: 'committed', results: [{ opId: 'update', action: 'record.update', status: 'updated', id: 'device-1' }] };
      throw new Error(`Unexpected request: ${path}`);
    });
    expect(await data.queryBatch({ count: data.collection(shared).query.count() })).toEqual({ count: { count: 2, capped: false } });
    await data.transact([{ opId: 'update', action: 'record.update', collection: shared, id: 'device-1', update: { $set: { title: 'Updated' } } }]);
    expect(sent).toHaveLength(2);
    expect(sent[0].body.queries).toMatchObject([{ collectionId: shared.collectionId }]);
    expect(sent[1].body.items).toMatchObject([{ collectionId: shared.collectionId }]);
  });

  it('ensures only owned declarations in a mixed transaction', async () => {
    const { data, sent } = fixture(path => {
      if (path.endsWith('/ensure')) return { results: [{ alias: 'orders', collectionId: 'owned-orders', revision: 1, status: 'unchanged' }] };
      if (path.endsWith('records:transact')) return { status: 'committed', results: [] };
      throw new Error(`Unexpected request: ${path}`);
    });
    await data.transact([
      { opId: 'owned', action: 'record.create', collection: owned, data: { title: 'New order' } },
      { opId: 'shared', action: 'record.read', collection: shared, id: 'device-1' },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[0].body.collections).toMatchObject([{ alias: 'orders' }]);
    expect(sent[0].body.collections).toHaveLength(1);
    expect(sent[1].body.items).toMatchObject([{ collectionId: 'owned-orders' }, { collectionId: shared.collectionId }]);
  });

  it('resolves a lookup reference by ID', async () => {
    const { data, sent } = fixture(path => {
      if (path.endsWith('records:aggregate')) return { items: [], pageInfo: { hasMore: false } };
      throw new Error(`Unexpected request: ${path}`);
    });
    await data.collection(shared).aggregate([{ $lookup: { from: { collectionId: 'existing-locations' }, localField: 'locationId', foreignField: '_id', as: 'location' } }]).toArray();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ collectionId: shared.collectionId, pipeline: [{ $lookup: { collectionId: 'existing-locations' } }] });
  });

  it.each(['read', 'transaction'] as const)('propagates revoked authorization for %s without retrying ensure or granting access', async kind => {
    const { data, sent } = fixture(() => denied());
    const request = kind === 'read'
      ? data.collection(shared).findOne({})
      : data.transact([{ opId: 'read', action: 'record.read', collection: shared, id: 'device-1' }]);
    await expect(request).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'COLLECTION_NOT_GRANTED' });
    expect(sent).toHaveLength(1);
  });

  it('subscribes to an existing ID without initializing unrelated declarations', async () => {
    const event = { eventId: 'event-1', collectionId: shared.collectionId, recordId: 'device-1', revision: 2, change: 'record', occurredAt: 1, restricted: false };
    const { data, sent } = fixture(path => {
      expect(path).toBe('/openapi/v2/uns/records:subscribe');
      return new Response(`id: event-1\nevent: change\ndata: ${JSON.stringify(event)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const events: SubscriptionEvent[] = [];
    for await (const item of data.subscribe({ collections: [shared] })) {
      events.push(item);
      break;
    }
    expect(events).toMatchObject([{ type: 'change', collection: shared.collectionId, collectionId: shared.collectionId }]);
    expect(sent).toHaveLength(1);
  });

  it('stops a refused shared subscription without trying to create the collection', async () => {
    const { data, sent } = fixture(() => denied());
    const stream = data.subscribe({ collections: [shared] })[Symbol.asyncIterator]();
    await expect(stream.next()).rejects.toBeInstanceOf(DataError);
    expect(sent).toHaveLength(1);
  });

  it('allows a reference-only client and rejects empty IDs', () => {
    const data = createDataClient({});
    expect(data.collection(shared).alias).toBe(shared.collectionId);
    for (const collectionId of ['', ' ', ' padded ']) expect(() => data.collection({ collectionId })).toThrow('collectionId');
  });
});
