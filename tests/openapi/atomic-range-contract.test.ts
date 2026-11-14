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

it('can remove exactly the additive range overlay to recover every preceding input hash', () => {
  const provenance = JSON.parse(read('contracts/uns-v2/provenance.json').toString());
  const update = provenance.schemaUpdates.at(-1);
  expect(update.scope).toBe('record-atomic-range-update');
  expect(update.operations).toEqual(['recordUpdateManyAtomic']);
  for (const [path, input] of Object.entries(update.inputs) as [string, any][]) {
    const bytes = read(path);
    expect(hash(bytes), path).toBe(input.resultSHA256);
    let reverted: string;
    if (path.endsWith('.go')) {
      reverted = bytes.toString().split('\n').filter(line => !line.includes('{Name: "recordUpdateManyAtomic"')).join('\n');
    } else {
      const value = JSON.parse(bytes.toString());
      if (path.endsWith('openapi-v2.source.json')) {
        delete value.paths['/uns/records:updateManyAtomic'];
        for (const name of update.schemas) delete value.components.schemas[name];
      } else {
        value.operations = value.operations.filter((item: any) => item.name !== 'recordUpdateManyAtomic');
        for (const name of update.schemas) delete value.schemas[name];
      }
      reverted = JSON.stringify(value, null, path.endsWith('/contract.json') ? undefined : 2) + '\n';
    }
    expect(hash(reverted), path).toBe(input.baseSHA256);
  }
});
