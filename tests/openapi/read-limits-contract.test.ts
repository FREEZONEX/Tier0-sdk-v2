import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_BATCH_QUERIES, MAX_GET_IDS } from '../../src/data/index.js';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));

describe('read counts without fixed upper bounds', () => {
  it('removes only the aggregate page size maximum and preserves its wire defaults', () => {
    for (const file of ['contracts/uns-v2/manifest.json', 'contracts/uns-v2/contract.json', 'contracts/openapi-v2.source.json']) {
      const contract = read(file);
      const schemas = contract.schemas ?? contract.components.schemas;
      expect(schemas.UnsV2PipelinePage.properties.size).toMatchObject({ type: 'integer', minimum: 1, default: 20 });
      expect(schemas.UnsV2PipelinePage.properties.size).not.toHaveProperty('maximum');
      const find = schemas.CloudRecordBatchQuery.oneOf.find((query: any) => query.properties.op.enum[0] === 'find');
      expect(find.properties.limit.maximum).toBe(200);
    }
    const overlay = read('contracts/upstream.json').schemaUpdates.find((entry: any) => entry.scope === 'aggregate-page-size');
    expect(overlay.schemas).toEqual(['UnsV2PipelinePage.properties.size']);
    expect(overlay.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(overlay.sourceKind).toBe('committed');
  });

  it('keeps nonempty typed inputs and per-page limits across the generated contracts', () => {
    for (const file of ['contracts/uns-v2/manifest.json', 'contracts/uns-v2/contract.json']) {
      const schemas = read(file).schemas;
      for (const operator of ['$in', '$nin']) {
        expect(schemas.UnsV2FieldComparisons.properties[operator]).toMatchObject({ type: 'array', minItems: 1 });
        expect(schemas.UnsV2FieldComparisons.properties[operator]).not.toHaveProperty('maxItems');
      }
      expect(schemas.UnsV2RecordGetReq.properties.ids).toMatchObject({ minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } });
      expect(schemas.UnsV2RecordGetReq.properties.ids).not.toHaveProperty('maxItems');
      expect(schemas.UnsV2RecordQueryBatchReq.properties.queries).toMatchObject({ minItems: 1 });
      expect(schemas.UnsV2RecordQueryBatchReq.properties.queries).not.toHaveProperty('maxItems');
      expect(schemas.UnsV2RecordQueryBatchResponse.properties.data.properties.results).not.toHaveProperty('maxProperties');
      const get = schemas.CloudRecordBatchQuery.oneOf.find((query: any) => query.properties.op.enum[0] === 'get');
      expect(get.properties.ids).not.toHaveProperty('maxItems');
      const find = schemas.CloudRecordBatchQuery.oneOf.find((query: any) => query.properties.op.enum[0] === 'find');
      expect(find.properties.limit.maximum).toBe(200);
      expect(schemas.UnsV2DataFilter['x-tier0-query-limits']).toMatchObject({ maxInItems: 0, maxLogicalItems: 64, maxFilterNodes: 128 });
    }
  });

  it('uses zero for removed dimensions and pins a committed Backend contract', () => {
    expect(MAX_GET_IDS).toBe(0);
    expect(MAX_BATCH_QUERIES).toBe(0);
    const schemas = read('contracts/uns-v2/manifest.json').schemas;
    for (const key of ['maxQueries', 'maxRows', 'maxBytes']) {
      expect(schemas.CloudAppDataLimits.properties.queryBatch.properties[key]).toMatchObject({ type: 'integer', minimum: 0 });
    }
    expect(schemas.CloudAppDataLimits.properties.get.properties.maxIds).toMatchObject({ type: 'integer', minimum: 0 });
    const overlay = read('contracts/upstream.json').schemaUpdates.find((entry: any) => entry.scope === 'unbounded-read-counts');
    expect(overlay.sourceKind).toBe('committed');
    expect(overlay.revision).toMatch(/^[a-f0-9]{40}$/);
  });
});
