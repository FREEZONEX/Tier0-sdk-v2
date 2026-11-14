import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, DataError, defineCollection } from '../../src/data/index.js';

const records = defineCollection({ alias: 'records', name: 'Records', schema: z.object({ value: z.number() }) });
const steps = [
  { opId: 'business-write', action: 'record.create' as const, collection: records, id: 'created', data: { value: 1 } },
  { opId: 'access-check', action: 'record.check' as const, collection: records, id: 'grant', exists: true },
];

function fixture(error: Record<string, unknown>, outcome?: unknown) {
  let writes = 0;
  const ok = (data: unknown) => Response.json({ code: 200, msg: 'ok', requestId: 'ok', data });
  const data = createDataClient({ collections: [records], apiHost: 'https://isolated.invalid', apiKey: 'test-only',
    logger: { info() {}, warn() {}, error() {} }, fetch: async url => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/collections/ensure')) return ok({ appId: 'app', results: [{ alias: records.alias, collectionId: 'records', status: 'unchanged', revision: 1 }] });
      if (path.endsWith('/records:transact')) {
        writes++;
        return outcome ? ok(outcome) : Response.json({ code: 409, msg: 'access-check failed', requestId: 'request',
          data: { opId: 'untrusted-detail' }, error: { code: 'CONDITION_FAILED', execution: 'rolledBack', retry: { safe: false }, details: [], ...error },
        }, { status: 409 });
      }
      throw new Error('Unexpected request: ' + path);
    } });
  return { data, writes: () => writes };
}

describe('DataError transaction attribution', () => {
  it.each(['access-check', 'business-write'])('preserves the canonical server opId %s through the data transport', async opId => {
    const f = fixture({ opId });
    const error = await f.data.transact(steps, { idempotencyKey: 'intent' }).catch(error => error);
    expect(error).toBeInstanceOf(DataError);
    expect(error).toMatchObject({ code: 'CONDITION_FAILED', opId, execution: 'rolledBack', outcomeUnknown: false,
      status: 409, upstreamStatus: 409, requestId: 'request', idempotencyKey: 'intent', attempts: 1,
      details: { opId: 'untrusted-detail' }, cause: { opId } });
    expect(f.writes()).toBe(1);
  });

  it('does not infer a step from the error message or data details', async () => {
    const f = fixture({});
    const error = await f.data.transact(steps).catch(error => error);
    expect(error).toBeInstanceOf(DataError);
    expect(error.opId).toBeUndefined();
    expect(error.message).toContain('access-check');
    expect(error.details).toEqual({ opId: 'untrusted-detail' });
  });

  it('preserves unknown execution independently of a known step without replaying', async () => {
    const f = fixture({ opId: 'access-check', execution: 'unknown' });
    await expect(f.data.transact(steps)).rejects.toMatchObject({ opId: 'access-check', execution: 'unknown', outcomeUnknown: true, attempts: 1 });
    expect(f.writes()).toBe(1);
  });

  it('keeps outcome result attribution in details without inventing a top-level step', async () => {
    const results = [{ opId: 'access-check', error: { code: 'CONDITION_FAILED' } }];
    const f = fixture({}, { status: 'rolledBack', results });
    const error = await f.data.transact(steps).catch(error => error);
    expect(error).toBeInstanceOf(DataError);
    expect(error).toMatchObject({ code: 'TRANSACTION_FAILED', execution: 'rolledBack', details: { results } });
    expect(error.opId).toBeUndefined();
  });
});
