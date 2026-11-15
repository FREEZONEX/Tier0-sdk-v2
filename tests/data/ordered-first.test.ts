import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDataClient, DataError } from '../../src/data/index.js';
import type { UnsV2PipelineAccumulator } from '../../src/uns-v2/generated.js';

const first: UnsV2PipelineAccumulator = { $first: '$_id' };
const pipeline = [
  { $match: { lineId: { $in: ['a', 'b'] }, state: { $in: ['Published', 'Imported baseline'] } } },
  { $sort: { state: -1, versionNumber: -1, _id: 1 } },
  { $group: { _id: '$lineId', versionId: first } },
];
function fixture(unsupported = false) {
  const requests: any[] = [];
  const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    if (unsupported) return Response.json({ code: 422, msg: 'Unsupported accumulator', requestId: 'fixture', data: null,
      error: { code: 'INVALID_REQUEST', execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 422 });
    return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: {
      items: [{ _id: requests.length === 1 ? 'a' : 'b', versionId: requests.length === 1 ? 'a-published' : 'b-baseline' }],
      pageInfo: requests.length === 1 ? { hasMore: true, nextPage: 2 } : { hasMore: false },
    } });
  } });
  return { data, requests };
}

describe('ordered first accumulator', () => {
  it('keeps sort order and aggregation on the server across all result pages', async () => {
    const f = fixture();
    const rows = await f.data.collection({ collectionId: 'versions' }).aggregate(pipeline).toArray();
    expect(rows).toEqual([{ _id: 'a', versionId: 'a-published' }, { _id: 'b', versionId: 'b-baseline' }]);
    expect(f.requests).toHaveLength(2);
    for (const request of f.requests) expect(request.pipeline).toEqual([
      pipeline[0], { $sort: [['state', -1], ['versionNumber', -1], ['_id', 1]] }, pipeline[2],
    ]);
    expect(f.requests[1].page.page).toBe(2);
  });

  it('surfaces old-server refusal without downloading all versions or retrying', async () => {
    const f = fixture(true);
    await expect(f.data.collection({ collectionId: 'versions' }).aggregate(pipeline).toArray()).rejects.toBeInstanceOf(DataError);
    expect(f.requests).toHaveLength(1);
  });

  it('keeps the same strict first-expression contract in all three synchronized inputs', () => {
    const variants = ['contracts/uns-v2/contract.json', 'contracts/uns-v2/manifest.json', 'contracts/openapi-v2.source.json'].map(path => {
      const document = JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
      return (document.schemas ?? document.components.schemas).UnsV2PipelineAccumulator.oneOf.filter((item: any) => item.properties?.$first);
    });
    expect(variants[0]).toEqual([{ type: 'object', additionalProperties: false,
      properties: { $first: { $ref: '#/components/schemas/UnsV2PipelineExpression' } }, required: ['$first'] }]);
    expect(variants[1]).toEqual(variants[0]); expect(variants[2]).toEqual(variants[0]);
  });
});
