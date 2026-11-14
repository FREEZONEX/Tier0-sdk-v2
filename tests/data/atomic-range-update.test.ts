import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection, type UpdateManyAtomicResult } from '../../src/data/index.js';

const jobs = defineCollection({ alias: 'jobs', name: 'Queue jobs', schema: z.object({
  state: z.string(), attempts: z.number().int(), availableAt: z.number().int(),
  leaseToken: z.string().optional(), parts: z.array(z.object({ state: z.string() })).optional(),
}), indexes: [{ path: 'state' }] });
const existing = { collectionId: 'existing-jobs', schema: jobs.schema };
const now = 1794618000123;
const outcome = (extra: Partial<UpdateManyAtomicResult> = {}) => ({
  matchedCount: 25_001, modifiedCount: 25_000, transactionTime: now, replayed: false, dryRun: false, ...extra,
});
const ok = (data: unknown) => Response.json({ code: 200, msg: 'ok', requestId: 'isolated-range', data });
const error = (code: string, execution = 'rolledBack', safe = false, data: unknown = null, status = 409) => Response.json({
  code: status, msg: code, requestId: 'isolated-range', data,
  error: { code, reason: code, execution, retry: { safe, afterMs: 0 }, details: [] },
}, { status });

function fixture() {
  const calls: { path: string; body: any }[] = [];
  let range: (body: any) => Response | Promise<Response> = () => ok(outcome());
  let partial: (body: any) => Response | Promise<Response> = () => { throw Error('Unexpected partial update'); };
  let collectionId = 'jobs-v1', indexState = 'ready';
  const data = createDataClient({ apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', collections: [jobs],
    logger: { info() {}, warn() {}, error() {} }, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body));
      calls.push({ path, body });
      if (path.endsWith('/collections/ensure')) return ok({ appId: 'range-app', results: [
        { alias: 'jobs', collectionId, status: 'unchanged', revision: 1 },
      ] });
      if (path.endsWith('/app/context')) return ok({ appId: 'range-app', collections: [{ alias: 'jobs', collectionId,
        indexStatus: [{ name: 'state-index', state: indexState, spec: { paths: ['state'], kind: 'btree', target: 'records' } }] }] });
      if (path.endsWith('/records:updateManyAtomic')) return range(body);
      if (path.endsWith('/records:updateMany')) return partial(body);
      throw new Error('Unexpected request: ' + path);
    } });
  return { data, calls, range(fn: typeof range) { range = fn; }, partial(fn: typeof partial) { partial = fn; },
    state(value: string) { indexState = value; }, reset() { collectionId = 'jobs-v2'; indexState = 'building'; },
    writes: () => calls.filter(call => call.path.endsWith('/records:updateManyAtomic')) };
}

describe('collection.updateManyAtomic', () => {
  it('returns more than 10000 matches from one range request without listing, chunking or a capability-size query', async () => {
    const f = fixture();
    const filter = { state: 'Running', $expr: { $lte: ['$availableAt', '$$NOW'] } };
    const update = { $set: { state: 'Retrying' }, $unset: { leaseToken: true }, $currentDate: { availableAt: true } };
    const result = await f.data.collection(existing).updateManyAtomic(filter, update);
    expectTypeOf(result).toEqualTypeOf<UpdateManyAtomicResult>();
    expect(result).toEqual(outcome());
    expect(f.calls).toHaveLength(1);
    expect(f.writes()[0].body).toMatchObject({ collectionId: existing.collectionId, filter, update });
    expect(f.writes()[0].body.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    for (const field of ['maxDocs', 'resumeAfter', 'limit', 'atomic', 'mode', 'upsert']) expect(f.writes()[0].body).not.toHaveProperty(field);
  });

  it('forwards standard array filters, an explicit receipt key and dryRun without adding local time', async () => {
    const f = fixture(); f.range(() => ok(outcome({ dryRun: true })));
    const result = await f.data.collection(jobs).updateManyAtomic({}, { $set: { 'parts.$[part].state': 'Retrying' } }, {
      arrayFilters: [{ 'part.state': 'Running' }], idempotencyKey: 'original-intent', dryRun: true,
    });
    expect(result).toEqual(outcome({ dryRun: true }));
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].body).toEqual({ collectionId: 'jobs-v1', filter: {}, update: { $set: { 'parts.$[part].state': 'Retrying' } },
      arrayFilters: [{ 'part.state': 'Running' }], idempotencyKey: 'original-intent', dryRun: true });
  });

  it('preserves replayed zero-match results and the original database clock', async () => {
    const f = fixture(); f.range(() => ok(outcome({ matchedCount: 0, modifiedCount: 0, replayed: true })));
    expect(await f.data.collection(existing).updateManyAtomic({}, { $inc: { attempts: 1 } }, { idempotencyKey: 'completed' }))
      .toEqual(outcome({ matchedCount: 0, modifiedCount: 0, replayed: true }));
    expect(f.calls).toHaveLength(1);
  });

  it('validates the update against the declaration before any request', async () => {
    const f = fixture();
    await expect(f.data.collection(jobs).updateManyAtomic({}, { $set: { attempts: 'bad' } })).rejects.toBeInstanceOf(z.ZodError);
    expect(f.calls).toHaveLength(0);
  });

  it('retries a proven rollback using the same body and key', async () => {
    const f = fixture(); let attempt = 0;
    f.range(() => ++attempt === 1 ? error('TEMPORARILY_UNAVAILABLE', 'rolledBack', true, null, 503) : ok(outcome()));
    await f.data.collection(existing).updateManyAtomic({}, { $inc: { attempts: 1 } });
    expect(f.writes()).toHaveLength(2);
    expect(f.writes()[1].body).toEqual(f.writes()[0].body);
  });

  it('surfaces unknown outcomes once even when the server advertises safe receipt replay', async () => {
    const f = fixture(); f.range(() => error('OUTCOME_UNKNOWN', 'unknown', true, null, 503));
    await expect(f.data.collection(existing).updateManyAtomic({}, { $inc: { attempts: 1 } }, { idempotencyKey: 'uncertain' }))
      .rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', outcomeUnknown: true, execution: 'unknown', attempts: 1, idempotencyKey: 'uncertain' });
    expect(f.calls).toHaveLength(1);
  });

  it('does not resend a lost transport response or fall back to partial writes', async () => {
    const f = fixture(); f.range(() => { throw new TypeError('connection lost'); });
    await expect(f.data.collection(existing).updateManyAtomic({}, { $inc: { attempts: 1 } }))
      .rejects.toMatchObject({ outcomeUnknown: true, execution: 'unknown', attempts: 1 });
    expect(f.calls).toHaveLength(1);
  });

  it.each([['FORBIDDEN', 403], ['NOT_FOUND', 404], ['DUPLICATE_KEY', 409], ['QUERY_TIMEOUT', 503]] as const)
  ('propagates %s without converting it to a successful or partial result', async (code, status) => {
    const f = fixture(); f.range(() => error(code, 'rolledBack', false, null, status));
    await expect(f.data.collection(existing).updateManyAtomic({}, { $set: { state: 'Retrying' } }))
      .rejects.toMatchObject({ code, execution: 'rolledBack' });
    expect(f.calls).toHaveLength(1);
  });

  it('checks fresh declared indexes and does not send the SDK-only flag', async () => {
    const f = fixture(); f.state('building');
    await expect(f.data.collection(jobs).updateManyAtomic({}, { $inc: { attempts: 1 } }, { requireIndexesReady: true }))
      .rejects.toMatchObject({ code: 'INDEX_NOT_READY', execution: 'notStarted' });
    expect(f.writes()).toHaveLength(0);
    f.state('ready');
    await f.data.collection(jobs).updateManyAtomic({}, { $inc: { attempts: 1 } }, { requireIndexesReady: true });
    expect(f.calls.filter(call => call.path.endsWith('/app/context'))).toHaveLength(2);
    expect(f.writes()[0].body).not.toHaveProperty('requireIndexesReady');
  });

  it('rechecks index readiness for the replacement collection before recovering a refused request', async () => {
    const f = fixture(); f.range(() => {
      f.reset(); return error('FORBIDDEN', 'notStarted', false, { reason: 'COLLECTION_NOT_FOUND', collectionId: 'jobs-v1' }, 403);
    });
    await expect(f.data.collection(jobs).updateManyAtomic({}, { $inc: { attempts: 1 } }, { requireIndexesReady: true }))
      .rejects.toMatchObject({ code: 'INDEX_NOT_READY', details: { collectionId: 'jobs-v2' } });
    expect(f.writes()).toHaveLength(1);
    expect(f.calls.filter(call => call.path.endsWith('/collections/ensure'))).toHaveLength(2);
    expect(f.calls.filter(call => call.path.endsWith('/app/context'))).toHaveLength(2);
  });

  it('refuses index-readiness checks for an existing-ID reference before IO', async () => {
    const f = fixture();
    await expect(f.data.collection(existing).updateManyAtomic({}, { $inc: { attempts: 1 } }, { requireIndexesReady: true }))
      .rejects.toThrow('declared collection');
    expect(f.calls).toHaveLength(0);
  });

  it('keeps the existing partial updateMany pagination and counts unchanged', async () => {
    const f = fixture(); f.partial(body => body.resumeAfter
      ? ok({ matchedCount: 2, modifiedCount: 2, hasMore: false })
      : ok({ matchedCount: 3, modifiedCount: 2, hasMore: true, resumeAfter: 'page-2' }));
    expect(await f.data.collection(existing).updateMany({}, { $inc: { attempts: 1 } })).toEqual({ matchedCount: 5, modifiedCount: 4 });
    expect(f.calls).toHaveLength(2); expect(f.writes()).toHaveLength(0);
    expect(f.calls.map(call => call.body.atomic)).toEqual([false, false]);
    expect(f.calls[1].body.resumeAfter).toBe('page-2');
  });

  it('retains partial updateMany committed counts and continuation when a later page fails', async () => {
    const f = fixture(); f.partial(body => body.resumeAfter
      ? error('DUPLICATE_KEY', 'committed', false, { matchedCount: 1, modifiedCount: 1, resumeAfter: 'page-3', hasMore: true })
      : ok({ matchedCount: 3, modifiedCount: 2, hasMore: true, resumeAfter: 'page-2' }));
    await expect(f.data.collection(existing).updateMany({}, { $inc: { attempts: 1 } })).rejects.toMatchObject({
      code: 'DUPLICATE_KEY', execution: 'committed', details: { matchedCount: 4, modifiedCount: 3, resumeAfter: 'page-3', hasMore: true },
    });
    expect(f.calls).toHaveLength(2); expect(f.writes()).toHaveLength(0);
  });
});
