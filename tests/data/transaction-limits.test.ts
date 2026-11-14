import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection, MAX_TRANSACTION_ITEMS, runWithAbortSignal } from '../../src/data/index.js';

const records = defineCollection({ alias: 'records', name: 'Records', schema: z.object({ value: z.number().int() }) });
const largeSteps = (count = 250) => Array.from({ length: count }, (_, i) => ({
  opId: `step-${i}`, action: 'record.create' as const, collection: records, id: `row-${i}`, data: { value: i },
}));
const capability = (maxItems = 10_000) => ({ maxItems, maxBodyBytes: 16 << 20, timeoutMs: 10_000 });

function fixture(declared = true) {
  const calls: { path: string; body: any }[] = [];
  let transaction: unknown = capability();
  let appId = 'test-app';
  let denied = false;
  let collectionId = 'c-records';
  let reset = false;
  let afterReset: unknown = capability();
  let outcome = 'committed';
  const ok = (data: unknown) => Response.json({ code: 200, msg: 'ok', requestId: 'test', data });
  const failure = (code: string, data: unknown = null) => Response.json({ code: 403, msg: code, requestId: 'test', data,
    error: { code, execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 403 });
  const data = createDataClient({ collections: declared ? [records] : [], apiHost: 'https://isolated.invalid', apiKey: 'test-only',
    environment: 'deployed', logger: { info() {}, warn() {}, error() {} }, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      calls.push({ path, body });
      if (path.endsWith('/ensure')) return ok({ appId: 'test-app', results: [{ alias: records.alias, collectionId, status: 'unchanged', revision: 1 }] });
      if (path.endsWith('/context')) return denied ? failure('FORBIDDEN') : ok({ appId, limits: transaction === undefined ? {} : { transaction } });
      if (path.endsWith('/records:transact')) {
        if (reset) {
          reset = false;
          const missing = collectionId;
          collectionId = 'c-records-new'; transaction = afterReset;
          return failure('FORBIDDEN', { reason: 'COLLECTION_NOT_FOUND', collectionId: missing });
        }
        return ok({ status: outcome, results: body.items.map((item: any) => ({ opId: item.opId, action: item.action, id: item.id, status: 'created' })) });
      }
      throw new Error('Unexpected request: ' + path);
    } });
  return { data, calls, limits(value: unknown) { transaction = value; }, app(value: string) { appId = value; },
    deny() { denied = true; }, outcome(value: string) { outcome = value; },
    reset(value: unknown = capability()) { reset = true; afterReset = value; },
    writes: () => calls.filter(c => c.path.endsWith('/records:transact')) };
}

describe('negotiated synchronous transaction capacity', () => {
  it('sends 250 steps together with explicit sync mode and the caller idempotency key', async () => {
    const f = fixture();
    const result = await f.data.transact(largeSteps(), { idempotencyKey: 'one-atomic-operation' });
    expect(result.results).toHaveLength(250);
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].body).toMatchObject({ mode: 'sync', idempotencyKey: 'one-atomic-operation' });
    expect(f.writes()[0].body.items).toHaveLength(250);
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(1);
  });

  it('refreshes effective capacity and never treats a prior capability read as permission to send', async () => {
    const f = fixture();
    expect(await f.data.getTransactionLimits()).toEqual(capability());
    f.limits(capability(240));
    await expect(f.data.transact(largeSteps())).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED', execution: 'notStarted', details: { requestedItems: 250, maxItems: 240 } });
    expect(f.writes()).toHaveLength(0);
  });

  it('falls back to 200 only when the capability is absent', async () => {
    const f = fixture(); f.limits(undefined);
    expect(await f.data.getTransactionLimits()).toEqual(capability(200));
    await expect(f.data.transact(largeSteps())).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED', execution: 'notStarted' });
    expect(f.writes()).toHaveLength(0);
  });

  it.each([null, {}, { ...capability(), maxItems: 0 }, { ...capability(), maxItems: 1.5 },
    { ...capability(), maxBodyBytes: -1 }, { ...capability(), timeoutMs: 0 }])('rejects malformed advertised capabilities without writes', async limits => {
    const f = fixture(); f.limits(limits);
    // The transport may reject the read response before local validation;
    // either path must reject without submitting any business transaction.
    await expect(f.data.transact(largeSteps())).rejects.toMatchObject({ code: 'DATA_BAD_RESPONSE', outcomeUnknown: false });
    expect(f.writes()).toHaveLength(0);
  });

  it('fails closed for another App or revoked access', async () => {
    const wrong = fixture(); wrong.app('another-app');
    await expect(wrong.data.transact(largeSteps())).rejects.toMatchObject({ code: 'DATA_BAD_RESPONSE' });
    expect(wrong.writes()).toHaveLength(0);
    const denied = fixture(); denied.deny();
    await expect(denied.data.transact(largeSteps())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(denied.writes()).toHaveLength(0);
  });

  it('caps effective capacity at the tested client ceiling and rejects excess before any IO', async () => {
    const f = fixture(); f.limits(capability(20_000));
    expect((await f.data.getTransactionLimits()).maxItems).toBe(MAX_TRANSACTION_ITEMS);
    const fresh = fixture();
    await expect(fresh.data.transact(largeSteps(MAX_TRANSACTION_ITEMS + 1))).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED', execution: 'notStarted' });
    expect(fresh.calls).toHaveLength(0);
  });

  it('keeps existing-ID clients without an App context on the legacy limit without auto-provisioning', async () => {
    const f = fixture(false);
    expect((await f.data.getTransactionLimits()).maxItems).toBe(200);
    await expect(f.data.transact(largeSteps().map(step => ({ ...step, collection: { collectionId: 'existing' } })))).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED' });
    expect(f.calls).toHaveLength(0);
  });

  it('does not add capability IO to transactions within the legacy ceiling', async () => {
    const f = fixture(); f.deny();
    await f.data.transact(largeSteps(2));
    expect(f.calls.some(c => c.path.endsWith('/context'))).toBe(false);
    expect(f.writes()).toHaveLength(1);
  });

  it('rechecks capacity when safely recovering a missing collection', async () => {
    const f = fixture(); f.reset(capability(200));
    await expect(f.data.transact(largeSteps())).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED', execution: 'notStarted' });
    expect(f.writes()).toHaveLength(1);
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(2);
  });

  it('resolves new collection IDs after recovery and still sends one whole transaction', async () => {
    const f = fixture(); f.reset();
    await f.data.transact(largeSteps());
    expect(f.writes()).toHaveLength(2);
    expect(f.writes()[1].body.items).toHaveLength(250);
    expect(f.writes()[1].body.items.every((item: any) => item.collectionId === 'c-records-new')).toBe(true);
  });

  it('does not replay unknown transaction results', async () => {
    const f = fixture(); f.outcome('unknown');
    await expect(f.data.transact(largeSteps())).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', execution: 'unknown' });
    expect(f.writes()).toHaveLength(1);
  });

  it('honors cancellation before capability lookup or transaction submission', async () => {
    const f = fixture(); await f.data.ensure();
    const controller = new AbortController(); controller.abort();
    await expect(runWithAbortSignal(controller.signal, () => f.data.transact(largeSteps()))).rejects.toMatchObject({ execution: 'notStarted' });
    expect(f.calls.filter(c => !c.path.endsWith('/ensure'))).toHaveLength(0);
  });
});
