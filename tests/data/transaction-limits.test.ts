import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection, MAX_TRANSACTION_ITEMS, runWithAbortSignal } from '../../src/data/index.js';
import { UnsV2RawNumber } from '../../src/uns-v2/codec.js';

const records = defineCollection({ alias: 'records', name: 'Records', schema: z.object({ value: z.number().int() }) });
const largeSteps = (count = 250) => Array.from({ length: count }, (_, i) => ({
  opId: `step-${i}`, action: 'record.create' as const, collection: records, id: `row-${i}`, data: { value: i },
}));
const capability = (maxItems = 10_000) => ({ maxItems, maxBodyBytes: 16 << 20, timeoutMs: 10_000 });

function fixture(declared = true) {
  const calls: { path: string; body: any; raw: string }[] = [];
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
      const raw = String(init?.body), body = JSON.parse(raw);
      calls.push({ path, body, raw });
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
  it.each([false, true, undefined])('honors the explicit unknown-commit replay policy: %s', async retryUnknown => {
    let calls = 0;
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only',
      fetch: async () => {
        calls++;
        if (calls === 1) return Response.json({ code: 503, msg: 'Unknown', requestId: 'fixture', data: null,
          error: { code: 'OUTCOME_UNKNOWN', execution: 'unknown', retry: { safe: true, afterMs: 0 }, details: [] },
        }, { status: 503 });
        return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: { status: 'committed', results: [] } });
      } });
    const request = data.transact([{ opId: 'guard', action: 'record.check', collection: { collectionId: 'records' }, id: 'row' }],
      { idempotencyKey: 'same-intent', retryUnknown });
    if (retryUnknown === false) {
      await expect(request).rejects.toMatchObject({ execution: 'unknown', outcomeUnknown: true, attempts: 1 });
      expect(calls).toBe(1);
    } else {
      await expect(request).resolves.toMatchObject({ status: 'committed' });
      expect(calls).toBe(2);
    }
  });

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
    const f = fixture(); f.limits(capability(MAX_TRANSACTION_ITEMS + 1));
    expect((await f.data.getTransactionLimits()).maxItems).toBe(MAX_TRANSACTION_ITEMS);
    const fresh = fixture();
    await expect(fresh.data.transact(largeSteps(MAX_TRANSACTION_ITEMS + 1))).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED', execution: 'notStarted' });
    expect(fresh.calls).toHaveLength(0);
  });

  it.each([8, 32, 64])('reports the effective byte ceiling for a server advertising %s MiB', async mib => {
    const f = fixture(); f.limits({ ...capability(), maxBodyBytes: mib << 20 });
    expect((await f.data.getTransactionLimits()).maxBodyBytes).toBe(Math.min(mib, 32) << 20);
  });

  it.each([1, 250])('refuses a %s-step oversized transaction with the same local error contract', async count => {
    const f = fixture(); f.limits({ ...capability(), maxBodyBytes: 64 << 20 });
    const steps = largeSteps(count).map((step, index) => ({ ...step, collection: { collectionId: 'c-records' },
      data: { value: index === 0 ? 'x'.repeat(32 << 20) : 'short' } }));
    await expect(f.data.transact(steps)).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', execution: 'notStarted',
      attempts: 0, outcomeUnknown: false, details: { maxBodyBytes: 32 << 20 } });
    expect(f.writes()).toHaveLength(0);
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(count > 200 ? 1 : 0);
  });

  it('retains a generated idempotency key across safe transport retries', async () => {
    const bodies: { idempotencyKey: string }[] = [];
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only',
      fetch: async (_, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1) return Response.json({ code: 503, msg: 'Retry', requestId: 'fixture', data: null,
          error: { code: 'UNAVAILABLE', execution: 'rolledBack', retry: { safe: true, afterMs: 0 }, details: [] } }, { status: 503 });
        return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: { status: 'committed', results: [] } });
      } });
    await data.transact([{ opId: 'guard', action: 'record.check', collection: { collectionId: 'records' }, id: 'row' }]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it('keeps existing-ID clients without an App context on the legacy limit without auto-provisioning', async () => {
    const f = fixture(false);
    expect((await f.data.getTransactionLimits()).maxItems).toBe(200);
    await expect(f.data.transact(largeSteps().map(step => ({ ...step, collection: { collectionId: 'existing' } })))).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED' });
    expect(f.calls).toHaveLength(0);
  });

  it('sends a large import as one negotiated transaction and refuses it on an older server', async () => {
    const steps = largeSteps(36_311);
    const old = fixture();
    await expect(old.data.transact(steps)).rejects.toMatchObject({ code: 'BATCH_LIMIT_EXCEEDED', execution: 'notStarted' });
    expect(old.writes()).toHaveLength(0);
    const current = fixture(); current.limits({ maxItems: 50_000, maxBodyBytes: 32 << 20, timeoutMs: 18_000 });
    await expect(current.data.transact(steps, { idempotencyKey: 'whole-import', retryUnknown: false })).resolves.toMatchObject({ status: 'committed' });
    expect(current.writes()).toHaveLength(1);
    expect(current.writes()[0].body.items).toHaveLength(steps.length);
  });

  it('rejects an oversized negotiated request before submitting any part', async () => {
    const f = fixture(); f.limits({ ...capability(), maxBodyBytes: 1000 });
    await expect(f.data.transact(largeSteps())).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', execution: 'notStarted', details: { maxBodyBytes: 1000 } });
    expect(f.writes()).toHaveLength(0);
  });

  it('measures the actual UTF-8 body with exact numbers and the generated idempotency key', async () => {
    const steps = largeSteps().map(step => ({ ...step, collection: { collectionId: 'c-records' },
      data: { value: new UnsV2RawNumber('9007199254740993'), label: '设备🙂' },
    }));
    const baseline = fixture();
    await baseline.data.transact(steps);
    const sent = baseline.writes()[0];
    expect(sent.raw).toContain('"value":9007199254740993');
    expect(sent.raw).toContain('设备🙂');
    expect(sent.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    const requestedBytes = Buffer.byteLength(sent.raw, 'utf8');
    expect(requestedBytes).toBeGreaterThan(sent.raw.length);

    const exact = fixture(); exact.limits({ ...capability(), maxBodyBytes: requestedBytes });
    await expect(exact.data.transact(steps)).resolves.toMatchObject({ status: 'committed' });
    expect(Buffer.byteLength(exact.writes()[0].raw, 'utf8')).toBe(requestedBytes);

    const smaller = fixture(); smaller.limits({ ...capability(), maxBodyBytes: requestedBytes - 1 });
    await expect(smaller.data.transact(steps)).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', execution: 'notStarted',
      details: { requestedBytes, maxBodyBytes: requestedBytes - 1 } });
    expect(smaller.writes()).toHaveLength(0);
  });

  it('retains wire-codec validation for bigint in arbitrary JSON before submission', async () => {
    const f = fixture();
    const steps = largeSteps().map(step => ({ ...step, collection: { collectionId: 'c-records' }, data: { value: 1n } }));
    await expect(f.data.transact(steps)).rejects.toThrow('bigint is only valid for signed int64 contract fields');
    expect(f.writes()).toHaveLength(0);
  });

  it('encodes each large-transaction value once for both the size check and the sent body', async () => {
    const f = fixture();
    let reads = 0;
    const steps = largeSteps().map(step => ({ ...step, collection: { collectionId: 'c-records' },
      data: { get value() { return ++reads; }, label: '设备🙂' },
    }));
    await f.data.transact(steps, { idempotencyKey: 'single-encoding' });
    expect(reads).toBe(steps.length);
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].body.items.map((item: any) => item.data.value)).toEqual(steps.map((_, index) => index + 1));
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
