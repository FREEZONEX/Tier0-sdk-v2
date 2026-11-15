import { describe, expect, it } from 'vitest';
import { createDataClient, DataError } from '../../src/data/index.js';
import type { UnsV2PipelineExpression } from '../../src/uns-v2/generated.js';

const expression: UnsV2PipelineExpression = { $jsonExtractText: { input: '$rawRecordJson', path: ['Mapping Status'] } };
const pipeline = [{ $set: { status: expression } }, { $match: { status: { $like: 'Deleted%' } } }];

describe('JSON text expression', () => {
  it('sends the expression to the server and preserves exact text results', async () => {
    const requests: unknown[] = [];
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: {
        items: [{ status: 'Deleted', exact: '9007199254740993', empty: '', missing: null }], pageInfo: { hasMore: false },
      } });
    } });
    const rows = await data.collection({ collectionId: 'evidence' }).aggregate(pipeline).toArray();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ collectionId: 'evidence', pipeline });
    expect(rows).toEqual([{ status: 'Deleted', exact: '9007199254740993', empty: '', missing: null }]);
  });

  it('keeps literal JSON input and unusual path keys unchanged on the wire', async () => {
    let request: unknown;
    const input = '{"a.b":{"x/y":"中文","$key":9007199254740993}}';
    const expr: UnsV2PipelineExpression = { $jsonExtractText: { input, path: ['a.b', '$key'] } };
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: { items: [], pageInfo: { hasMore: false } } });
    } });
    await data.collection({ collectionId: 'evidence' }).aggregate([{ $project: { exact: expr } }]).toArray();
    expect(request).toMatchObject({ pipeline: [{ $project: { exact: expr } }] });
  });

  it('surfaces unsupported-server errors without local evaluation or fallback reads', async () => {
    let calls = 0;
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async () => {
      calls++;
      return Response.json({ code: 422, msg: 'Unsupported expression', requestId: 'fixture', data: null,
        error: { code: 'INVALID_REQUEST', execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 422 });
    } });
    await expect(data.collection({ collectionId: 'evidence' }).aggregate(pipeline).toArray()).rejects.toBeInstanceOf(DataError);
    expect(calls).toBe(1);
  });
});
