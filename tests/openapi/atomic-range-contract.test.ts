import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { UNS_V2_OPERATIONS } from '../../src/uns-v2/generated.js';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(read('contracts/uns-v2/manifest.json').toString());

it('exposes a distinct App-authorized atomic range operation with no partial continuation', () => {
  const operation = manifest.operations.find((item: any) => item.name === 'recordUpdateManyAtomic');
  expect(operation).toMatchObject({ method: 'POST', suffix: '/uns/records:updateManyAtomic', appAllowed: true, permission: 'uns.write' });
  expect(operation.partialCommit).not.toBe(true);
  expect(UNS_V2_OPERATIONS.recordUpdateManyAtomic).toMatchObject({
    path: '/openapi/v2/uns/records:updateManyAtomic', pathParams: [], mutation: true, idempotencyKey: true,
  });
  const request = manifest.schemas[operation.request];
  expect(request.required).toEqual(['collectionId', 'filter', 'update']);
  expect(Object.keys(request.properties).sort()).toEqual(['arrayFilters', 'collectionId', 'dryRun', 'filter', 'idempotencyKey', 'update']);
  const result = manifest.schemas.CloudRecordUpdateManyAtomicResult;
  expect(result.required.slice().sort()).toEqual(['dryRun', 'matchedCount', 'modifiedCount', 'replayed', 'transactionTime']);
  expect(result.properties.transactionTime.type).toBe('integer');
  expect(manifest.operations.find((item: any) => item.name === 'recordUpdateMany').partialCommit).toBe(true);
});

// Pinned to the reviewed atomic addition at 05d09f9. Later independent
// overlays may change other schemas, but never this operation or its own DTOs.
it('preserves the atomic addition and follows subsequent input provenance', () => {
  const provenance = JSON.parse(read('contracts/uns-v2/provenance.json').toString());
  const position = provenance.schemaUpdates.findIndex((item: any) => item.scope === 'record-atomic-range-update');
  expect(position).toBeGreaterThanOrEqual(0);
  const update = provenance.schemaUpdates[position];
  expect(update.operations).toEqual(['recordUpdateManyAtomic']);
  const pinned: Record<string, string> = {
    'contracts/uns-v2/contract.json': '3f97a97188506f6df50270e0b25bda81fe67bb0afcc78ff00012207b59c94df1',
    'contracts/uns-v2/manifest.json': '759cd3d98cf2331927803b890bc553189abc82671ad710e370d8fa78eb20a4ea',
    'contracts/openapi-v2.source.json': 'fbc9cb83be0b1c37ed0f4f1622ea2409fe70b903b3f31244b5bc97faf35b261c',
  };
  for (const [path, input] of Object.entries(update.inputs) as [string, any][]) {
    const bytes = read(path);
    let expected = input.resultSHA256;
    for (const later of provenance.schemaUpdates.slice(position + 1)) {
      if (!later.inputs[path]) continue;
      expect(later.inputs[path].baseSHA256, path + ': ' + later.scope).toBe(expected);
      expected = later.inputs[path].resultSHA256;
    }
    expect(hash(bytes), path).toBe(expected);
    if (path.endsWith('.go')) {
      const reverted = bytes.toString().split('\n').filter(line => !line.includes('{Name: "recordUpdateManyAtomic"')).join('\n');
      expect(hash(reverted), path).toBe(input.baseSHA256);
    } else {
      const value = JSON.parse(bytes.toString()), schemas = value.schemas ?? value.components.schemas;
      const operation = path.endsWith('openapi-v2.source.json') ? value.paths['/uns/records:updateManyAtomic'] : value.operations.find((item: any) => item.name === 'recordUpdateManyAtomic');
      expect(hash(JSON.stringify({ operation, schemas: Object.fromEntries(update.schemas.map((name: string) => [name, schemas[name]])) })), path).toBe(pinned[path]);
    }
  }
});
