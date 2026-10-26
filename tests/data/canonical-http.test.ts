import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection } from '../../src/data/index.js';

// Real HTTP boundary only: these receipts test adapters, not database atomicity.
const declaration = defineCollection({ alias: 'orders', schema: z.object({ code: z.string(), qty: z.number().int() }) });
const requests: { path: string; body: Record<string, any> }[] = [];
let respond: (res: ServerResponse, body: Record<string, any>) => void;
const send = (res: ServerResponse, data: unknown, status = 200, error?: object) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: status, msg: '', requestId: 'canonical-http', data, ...(error ? { error } : {}) }));
};
const server = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  requests.push({ path: req.url!, body });
  if (req.url === '/openapi/v2/uns/app/collections/ensure') {
    send(res, { appId: 'fixture', results: [{ alias: 'orders', collectionId: 'orders-id', revision: 1, status: 'unchanged', ignored: [], warnings: [], indexStatus: [] }] });
    return;
  }
  respond(res, body);
});
let apiHost: string;
const collection = async () => {
  const data = createDataClient({ apiHost, apiKey: 'local-fixture', collections: [declaration], logger: { info() {}, warn() {}, error() {} } });
  await data.ensure();
  requests.length = 0;
  return data.collection(declaration);
};
const snapshot = { id: 'one', collectionId: 'orders-id', revision: 7, createdAt: 10, updatedAt: 11, data: { code: 'A', qty: 2 } };
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

describe('App convenience methods use canonical v2 operations', () => {
  it('inserts in one ordered atomic bulk and preserves ID order plus the deliberate replay body', async () => {
    const handle = await collection();
    let replayed = false;
    respond = res => { send(res, { insertedCount: 2, insertedIds: { 1: 'second', 0: 'first' }, status: 'committed', replayed }); replayed = true; };
    const docs = [{ _id: 'first', code: 'A', qty: 1 }, { _id: 'second', code: 'B', qty: 2 }];
    const options = { idempotencyKey: 'one-intent' };
    expect(await handle.insertMany(docs, options)).toEqual({ insertedCount: 2, insertedIds: ['first', 'second'] });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ path: '/openapi/v2/uns/collections/orders-id/records:bulkWrite', body: {
      collectionId: 'orders-id', operations: [{ insertOne: { id: 'first', data: { code: 'A', qty: 1 } } }, { insertOne: { id: 'second', data: { code: 'B', qty: 2 } } }],
      atomic: true, ordered: true, idempotencyKey: 'one-intent',
    } });
    expect(await handle.insertMany(docs, options)).toEqual({ insertedCount: 2, insertedIds: ['first', 'second'] });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it('preserves single-write snapshots, sort, projection, revision, upsert and null without readback', async () => {
    const handle = await collection();
    respond = res => send(res, { value: snapshot, status: 'committed', replayed: false });
    const options = { sort: { code: 1 as const }, projection: { code: 1 as const }, expectedRevision: 6, idempotencyKey: 'update', upsert: true };
    expect((await handle.findOneAndUpdate({ code: 'A' }, { $inc: { qty: 1 } }, options))?._meta.revision).toBe(7);
    expect((await handle.findOneAndReplace({ code: 'A' }, { code: 'A', qty: 2 }, { ...options, returnDocument: 'before', idempotencyKey: 'replace' }))?._id).toBe('one');
    expect((await handle.findOneAndDelete({ code: 'A' }, { sort: options.sort, projection: options.projection, expectedRevision: 7, idempotencyKey: 'delete' }))?.code).toBe('A');
    expect(requests.map(row => row.path.split(':').at(-1))).toEqual(['updateOne', 'replaceOne', 'deleteOne']);
    expect(requests[0].body).toEqual({ collectionId: 'orders-id', filter: { code: 'A' }, update: { $inc: { qty: 1 } }, upsert: true,
      expectedRevision: 6, sort: [['code', 1]], returnDocument: 'after', projection: { code: 1 }, idempotencyKey: 'update' });
    expect(requests[1].body).toMatchObject({ replacement: { code: 'A', qty: 2 }, returnDocument: 'before', upsert: true, expectedRevision: 6 });
    expect(requests[2].body).toMatchObject({ returnDocument: 'before', expectedRevision: 7, projection: { code: 1 } });
    respond = res => send(res, { value: null, status: 'committed', replayed: false });
    expect(await handle.findOneAndUpdate({ code: 'absent' }, { $inc: { qty: 1 } })).toBeNull();
    expect(requests).toHaveLength(4);
  });

  it('does not resend an unknown write or reinterpret a grant failure as success', async () => {
    const handle = await collection();
    respond = res => send(res, null, 503, { code: 'OUTCOME_UNKNOWN', details: [], execution: 'unknown', retry: { safe: false } });
    await expect(handle.insertMany([{ code: 'A', qty: 1 }], { idempotencyKey: 'unknown-intent' })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', outcomeUnknown: true, idempotencyKey: 'unknown-intent', attempts: 1 });
    expect(requests).toHaveLength(1);
    respond = res => send(res, { reason: 'APP_PERMISSION_MISSING' }, 403, { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } });
    await expect(handle.findOneAndDelete({ code: 'A' })).rejects.toMatchObject({ code: 'FORBIDDEN', reason: 'APP_PERMISSION_MISSING', execution: 'notStarted' });
    expect(requests).toHaveLength(2);
  });

  it('collects aggregate distinct pages without losing null and structured values', async () => {
    const handle = await collection();
    respond = (res, body) => send(res, body.page.page === 1
      ? { items: [{ _id: null }, { _id: { nested: true } }], pageInfo: { hasMore: true, nextPage: 2 } }
      : { items: [{ _id: ['A', 'B'] }], pageInfo: { hasMore: false } });
    expect(await handle.distinct('code', { qty: { $gt: 0 } })).toEqual([null, { nested: true }, ['A', 'B']]);
    expect(requests).toHaveLength(2);
    for (const row of requests) {
      expect(row.path).toBe('/openapi/v2/uns/collections/orders-id/records:aggregate');
      expect(row.body.pipeline).toEqual([{ $match: { qty: { $gt: 0 } } }, { $group: { _id: '$code' } }]);
    }
    expect(requests.map(row => row.body.page)).toEqual([{ mode: 'offset', page: 1, size: 200 }, { mode: 'offset', page: 2, size: 200 }]);
  });
});
