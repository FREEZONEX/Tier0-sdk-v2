import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDataClient, DataError } from '../../src/data/index.js';
import type { UnsV2PipelineExpression } from '../../src/uns-v2/generated.js';

describe('aggregation membership expression', () => {
  it.each([
    [],
    [null, true, 1, '1', '$literal-label', '中文', '中文'],
    Array.from({ length: 301 }, (_, i) => `technology-${i}`),
  ].map(members => ({ members })))('preserves literal members in one aggregate request (%#)', async ({ members }) => {
    const expression: UnsV2PipelineExpression = { $in: ['$level1', { $literal: members }] };
    const pipeline = [{ $group: { _id: '$siteId', selected: { $sum: { $cond: [expression, 1, 0] } } } }];
    const requests: unknown[] = [];
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: { items: [{ _id: 'site', selected: 2 }], pageInfo: { hasMore: false } } });
    } });
    expect(await data.collection({ collectionId: 'resources' }).aggregate(pipeline).toArray()).toEqual([{ _id: 'site', selected: 2 }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ pipeline });
  });

  it('preserves dynamic array expressions without evaluating or rewriting them', async () => {
    const expression: UnsV2PipelineExpression = { $in: ['$level1', { $cond: ['$enabled', '$allowed', '$fallback'] }] };
    const pipeline = [{ $project: { selected: expression } }];
    let request: unknown;
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: { items: [], pageInfo: { hasMore: false } } });
    } });
    await data.collection({ collectionId: 'resources' }).aggregate(pipeline).toArray();
    expect(request).toMatchObject({ pipeline });
  });

  it('surfaces server rejection without local evaluation or fallback reads', async () => {
    let calls = 0;
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async () => {
      calls++;
      return Response.json({ code: 422, msg: '$in second operand must evaluate to an array of scalar values', requestId: 'fixture', data: null,
        error: { code: 'INVALID_REQUEST', execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 422 });
    } });
    await expect(data.collection({ collectionId: 'resources' }).aggregate([{ $project: { selected: { $in: ['$level1', '$allowed'] } } }]).toArray()).rejects.toBeInstanceOf(DataError);
    expect(calls).toBe(1);
  });

  it('publishes only the second-operand literal-array extension across all contracts', () => {
    for (const path of ['contracts/uns-v2/contract.json', 'contracts/uns-v2/manifest.json', 'contracts/openapi-v2.source.json']) {
      const input = JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
      const schemas = input.schemas ?? input.components.schemas;
      const choices = schemas.UnsV2PipelineExpression.oneOf;
      const membership = choices.find((item: any) => item.properties?.$in).properties.$in;
      expect(membership).toMatchObject({ type: 'array', minItems: 2, maxItems: 2 });
      const literal = membership.items.oneOf.find((item: any) => item.properties?.$literal).properties.$literal;
      expect(literal).toEqual({ type: 'array', items: { $ref: '#/components/schemas/UnsV2FilterScalar' } });
      expect(choices.find((item: any) => item.properties?.$literal).properties.$literal).toEqual({ $ref: '#/components/schemas/UnsV2FilterScalar' });
    }
  });
});
