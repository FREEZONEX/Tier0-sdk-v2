import { describe, expect, it } from 'vitest';
import { createDataClient, DataError } from '../../src/data/index.js';
import type { UnsV2PipelineStage } from '../../src/uns-v2/generated.js';

const pipeline: UnsV2PipelineStage[] = [{ $lookup: {
  collectionId: 'source-mappings', localField: '_id', foreignField: 'resourceId', as: 'evidence',
  let: { site: '$siteId', label: "quoted's ? 中文", literal: { $literal: '$key' } },
  pipeline: [
    { $match: { $expr: { $eq: ['$siteId', '$$site'] } } },
    { $project: { _id: 1, label: '$$label', literal: '$$literal' } },
    { $limit: 1 },
  ],
} }];

describe('correlated lookup variables', () => {
  it('resolves App-style lookup targets while keeping the one-result subpipeline and bindings', async () => {
    let request: unknown;
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: { items: [], pageInfo: { hasMore: false } } });
    } });
    const lookup = pipeline[0] as Extract<UnsV2PipelineStage, { $lookup: unknown }>;
    const { collectionId, ...options } = lookup.$lookup;
    const stages = [{ $lookup: { ...options, from: { collectionId } } }];
    const original = structuredClone(stages);
    await data.collection({ collectionId: 'resources' }).aggregate(stages).toArray();
    expect(request).toMatchObject({ collectionId: 'resources', pipeline });
    expect(stages).toEqual(original);
  });

  it('sends one server query with the complete correlation and retains caller input', async () => {
    const requests: unknown[] = [];
    const before = structuredClone(pipeline);
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: {
        items: [{ _id: 'resource-a', evidence: [{ _id: 'mapping-a', label: "quoted's ? 中文", literal: '$key' }] }],
        pageInfo: { hasMore: false },
      } });
    } });
    const rows = await data.collection({ collectionId: 'resources' }).aggregate(pipeline).toArray();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ collectionId: 'resources', pipeline });
    expect(rows).toEqual([{ _id: 'resource-a', evidence: [{ _id: 'mapping-a', label: "quoted's ? 中文", literal: '$key' }] }]);
    expect(pipeline).toEqual(before);
  });

  it('preserves nested variable declarations and references for server scoping', async () => {
    const nested: UnsV2PipelineStage[] = [{ $lookup: {
      collectionId: 'resources', localField: '_id', foreignField: '_id', as: 'matched', let: { name: 'outer' },
      pipeline: [{ $lookup: {
        collectionId: 'resources', localField: '_id', foreignField: '_id', as: 'inner',
        let: { name: 'inner', captured: '$$name' },
        pipeline: [{ $project: { name: '$$name', captured: '$$captured', clock: '$$NOW' } }],
      } }],
    } }];
    let request: unknown;
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data: { items: [], pageInfo: { hasMore: false } } });
    } });
    await data.collection({ collectionId: 'resources' }).aggregate(nested).toArray();
    expect(request).toMatchObject({ pipeline: nested });
  });

  it('surfaces unsupported-server errors without fallback queries', async () => {
    let calls = 0;
    const data = createDataClient({ collections: [], apiHost: 'https://isolated.invalid', apiKey: 'fixture-only', fetch: async () => {
      calls++;
      return Response.json({ code: 422, msg: 'Unsupported lookup option', requestId: 'fixture', data: null,
        error: { code: 'INVALID_REQUEST', execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 422 });
    } });
    await expect(data.collection({ collectionId: 'resources' }).aggregate(pipeline).toArray()).rejects.toBeInstanceOf(DataError);
    expect(calls).toBe(1);
  });
});
