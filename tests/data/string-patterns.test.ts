import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection, DataError } from '../../src/data/index.js';
import type { UnsV2FieldPredicate } from '../../src/uns-v2/generated.js';

const resources = defineCollection({ alias: 'resources', name: 'Resources', schema: z.object({ code: z.string() }) });
function fixture(unsupported = false) {
  const requests: { path: string; body: Record<string, any> }[] = [];
  const response = (data: unknown) => Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data });
  const data = createDataClient({ collections: [resources], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only',
    logger: { info() {}, warn() {}, error() {} }, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body));
      requests.push({ path, body });
      if (path.endsWith('/ensure')) return response({ appId: 'fixture', results: [{ alias: resources.alias, collectionId: 'resource-collection', revision: 1, status: 'unchanged' }] });
      if (unsupported) return Response.json({ code: 422, msg: 'Unsupported predicate', requestId: 'fixture', data: null,
        error: { code: 'INVALID_REQUEST', execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 422 });
      if (path.endsWith('/records:transact')) return response({ status: 'committed', results: [] });
      if (path.endsWith('/records:find') || path.endsWith('/records:aggregate')) return response({ items: [], pageInfo: { hasMore: false } });
      throw new Error('Unexpected request ' + path);
    } });
  return { data, requests };
}

describe('PostgreSQL string patterns', () => {
  it('preserves wildcards, escapes, Unicode and empty patterns through find without expanding them into client-side filters', async () => {
    const f = fixture();
    const patterns = ['', '%', '_', String.raw`a\_b`, String.raw`a\\b`, 'é%设备_', "' OR TRUE --"];
    for (const pattern of patterns) {
      const predicate: UnsV2FieldPredicate = { $ilike: pattern };
      await f.data.collection(resources).find({ code: predicate }).toArray();
    }
    const reads = f.requests.filter(row => row.path.endsWith('/records:find'));
    expect(reads).toHaveLength(patterns.length);
    expect(reads.map(row => row.body.filter)).toEqual(patterns.map(pattern => ({ code: { $ilike: pattern } })));
  });

  it('uses the same pattern predicate for aggregate, logical negation and atomic record checks', async () => {
    const f = fixture();
    const predicate: UnsV2FieldPredicate = { $not: { $like: String.raw`legacy\_%` } };
    await f.data.collection(resources).aggregate([{ $match: { code: predicate } }]).toArray();
    await f.data.transact([{ opId: 'check', action: 'record.check', collection: resources, id: 'r1', filter: { code: { $ilike: 'A_%' } } }], { retryUnknown: false });
    expect(f.requests.find(row => row.path.endsWith('/records:aggregate'))!.body.pipeline).toEqual([{ $match: { code: predicate } }]);
    expect(f.requests.find(row => row.path.endsWith('/records:transact'))!.body.items[0].filter).toEqual({ code: { $ilike: 'A_%' } });
  });

  it('surfaces older-server rejection without substituting contains, querying all records or retrying', async () => {
    const f = fixture(true);
    await expect(f.data.collection(resources).find({ code: { $ilike: '%A_%' } }).toArray()).rejects.toBeInstanceOf(DataError);
    const reads = f.requests.filter(row => row.path.endsWith('/records:find'));
    expect(reads).toHaveLength(1); expect(reads[0].body.filter).toEqual({ code: { $ilike: '%A_%' } });
  });
});
