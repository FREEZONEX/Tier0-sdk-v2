import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, type TransactResultItem, type TransactStep } from '../../src/data/index.js';

const collection = { collectionId: 'clock-records' };
const timestamp = 1794567600123;
function fixture(withClock: boolean) {
  const calls: { path: string; body: any }[] = [];
  const data = createDataClient({ apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', collections: [],
    logger: { info() {}, warn() {}, error() {} }, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)); calls.push({ path, body });
      if (!path.endsWith('/records:transact')) throw new Error(`Unexpected request: ${path}`);
      const results = body.items.map((item: any) => ({
        opId: item.opId, action: item.action, id: item.id, status: item.action === 'record.read' ? 'read' : 'checked',
        collectionId: collection.collectionId, revision: 4,
        ...(withClock && ['record.check', 'record.read'].includes(item.action) ? { transactionTime: timestamp } : {}),
        ...(item.action === 'record.read' ? { document: { id: item.id, data: { value: 'persisted' }, revision: 4, createdAt: 100, updatedAt: 200 } } : {}),
      }));
      return Response.json({ code: 200, msg: 'ok', requestId: 'isolated', data: { status: body.dryRun ? 'validated' : 'committed', results } });
    } });
  return { data, calls };
}

describe('database transaction time results', () => {
  it('exposes the optional timestamp as a number without changing existing result or document fields', async () => {
    expectTypeOf<TransactResultItem['transactionTime']>().toEqualTypeOf<number | undefined>();
    const f = fixture(true);
    const result = await f.data.transact([
      { opId: 'clock', action: 'record.check', collection, id: 'guard', exists: true },
      { opId: 'read', action: 'record.read', collection, id: 'row' },
    ]);
    expect(result.results.map(item => item.transactionTime)).toEqual([timestamp, timestamp]);
    expect(result.results[0]).toMatchObject({ opId: 'clock', status: 'checked', revision: 4 });
    expect(result.results[1].document).toEqual({ _id: 'row', value: 'persisted', _meta: { revision: 4, createdAt: 100, updatedAt: 200 } });
    expect(f.calls).toHaveLength(1);
  });

  it('keeps older server results without a clock compatible and does not synthesize application time', async () => {
    const f = fixture(false);
    const result = await f.data.transact([{ opId: 'read', action: 'record.read', collection, id: 'row' }]);
    expect(result.status).toBe('committed');
    expect(result.results[0]).not.toHaveProperty('transactionTime');
    expect(f.calls).toHaveLength(1);
  });

  it('forwards resultPath transactionTime bindings unchanged in the same transaction', async () => {
    const f = fixture(true);
    await f.data.transact([
      { opId: 'clock', action: 'record.check', collection, id: 'guard' },
      { opId: 'event', action: 'record.create', collection, id: 'event', data: { createdAt: 0 }, dependsOn: ['clock'],
        bindings: [{ path: 'data.createdAt', ref: 'clock', resultPath: 'transactionTime' }] },
    ], { idempotencyKey: 'one-commit' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].body.items[1].bindings).toEqual([{ path: 'data.createdAt', ref: 'clock', resultPath: 'transactionTime' }]);
    expect(f.calls[0].body).toMatchObject({ mode: 'sync', idempotencyKey: 'one-commit' });
  });

  it('forwards ISO formatting for string fields without formatting or replacing the database clock locally', async () => {
    expectTypeOf<NonNullable<TransactStep['bindings']>[number]['format']>().toEqualTypeOf<'iso8601' | undefined>();
    const f = fixture(true);
    const result = await f.data.transact([
      { opId: 'clock', action: 'record.check', collection, id: 'guard' },
      { opId: 'audit', action: 'record.create', collection: { ...collection, schema: z.object({ createdAt: z.string() }) },
        id: 'audit', data: {}, dependsOn: ['clock'],
        bindings: [{ path: 'data.createdAt', ref: 'clock', resultPath: 'transactionTime', format: 'iso8601' }] },
    ]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].body.items[1]).toMatchObject({ data: {},
      bindings: [{ path: 'data.createdAt', ref: 'clock', resultPath: 'transactionTime', format: 'iso8601' }] });
    expect(result.results[0].transactionTime).toBe(timestamp);
  });

  it('keeps server-bound upsert placeholders while validating literal update fields', async () => {
    const f = fixture(true);
    const target = { ...collection, schema: z.object({
      value: z.number().int(), createdAt: z.number().int().min(1), updatedAt: z.string(),
    }) };
    const update = { $set: { value: 1, updatedAt: null }, $setOnInsert: { createdAt: 0 } };
    const bindings = [
      { path: 'update/$setOnInsert/createdAt', ref: 'clock', resultPath: 'transactionTime' },
      { path: 'update/$set/updatedAt', ref: 'clock', resultPath: 'transactionTime', format: 'iso8601' as const },
    ];
    const steps: TransactStep[] = [
      { opId: 'clock', action: 'record.check', collection, id: 'guard' },
      { opId: 'upsert', action: 'record.update', collection: target, filter: { _id: 'row' },
        update, upsert: true, dependsOn: ['clock'], bindings },
    ];
    await f.data.transact(steps);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].body.items[1]).toMatchObject({ action: 'record.update', upsert: true, update, bindings });
    expect(update.$set.updatedAt).toBeNull();
    expect(update.$setOnInsert.createdAt).toBe(0);
    await expect(f.data.transact([steps[0], { ...steps[1],
      update: { ...update, $set: { ...update.$set, value: 'invalid' } },
    }])).rejects.toBeInstanceOf(z.ZodError);
    expect(f.calls).toHaveLength(1);
  });

  it.each([
    { update: { $set: { value: null } }, path: 'update/$set/value/child' },
    { update: { $set: { value: null } }, path: 'update/$setOnInsert/value' },
    { update: { $set: { undeclared: null } }, path: 'update/$set/undeclared' },
    { update: { $inc: { value: null } }, path: 'update/$inc/value' },
  ])('does not relax literal or declared-path validation for $path', async ({ update, path }) => {
    const f = fixture(true);
    await expect(f.data.transact([{ opId: 'write', action: 'record.update', id: 'row',
      collection: { ...collection, schema: z.object({ value: z.number() }) }, update,
      bindings: [{ path, ref: 'clock', resultPath: 'transactionTime' }],
    }])).rejects.toBeInstanceOf(z.ZodError);
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    { resultPath: 'revision', format: 'iso8601' },
    { resultPath: 'data.createdAt', format: 'iso8601' },
    { resultPath: 'transactionTime', format: 'unix' },
    { resultPath: 'transactionTime', format: null },
  ])('rejects invalid formatting before network IO: %j', async (input) => {
    const f = fixture(true);
    const step = { opId: 'audit', action: 'record.create', collection, id: 'audit', data: {},
      bindings: [{ path: 'data.createdAt', ref: 'clock', ...input }] } as unknown as TransactStep;
    await expect(f.data.transact([step])).rejects.toThrow('Binding format iso8601 requires resultPath transactionTime.');
    expect(f.calls).toHaveLength(0);
  });
});
