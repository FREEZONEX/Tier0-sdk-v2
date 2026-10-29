import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { UNS_V2_OPERATIONS, UNS_V2_STREAM_OPERATIONS } from '../../src/uns-v2/generated.js';

// The 0.6.2 common contract includes Core-only graph metadata. Its presence here
// does not export the operation or authorize App credentials to invoke it.
const names = `dataDiscover collectionDescribe catalog graph namespace topics references jobs
recordTransactionExecute sampleAppend recordFind recordCount recordAggregatePipeline recordExplain
recordInsertOne recordUpdateOne recordReplaceOne recordDeleteOne recordUpdateMany recordDeleteMany recordBulkWrite
sampleLatestValues sampleDeleteRange appDataPolicyGet appDataPolicyUpdate dataAppContext recordSubscribe
appCollectionsEnsure appCollectionsSchemaReplace appCollectionsArchive appCollectionsRestore appCollectionsList appStreamAccessList
sampleFind sampleAggregate recordLock recordRenew recordUnlock recordGet recordRestore recordQueryBatch
metadataFind metadataCount metadataAggregate metadataInsertOne metadataUpdateOne metadataReplaceOne metadataDeleteOne
metadataUpdateMany metadataDeleteMany metadataRestore metadataBulkWrite metadataTransact`.split(/\s+/);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
}

it('preserves the released Namespace contract except explicit App context and Stream view changes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../contracts/uns-v2/manifest.json', import.meta.url), 'utf8'));
  const operations = Object.fromEntries(names.map(name => {
    const operation = manifest.operations.find((item: { name: string }) => item.name === name);
    expect(operation, name).toBeDefined();
    if (name === 'graph') expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
    else expect(Object.hasOwn(UNS_V2_OPERATIONS, name) || Object.hasOwn(UNS_V2_STREAM_OPERATIONS, name), name).toBe(true);
    return [name, operation];
  }));
  const schemas: Record<string, unknown> = {};
  const queue: string[] = Object.values(operations).flatMap(operation => [operation.request, operation.response]);
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value && typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/')) {
      queue.push(value.$ref.slice('#/components/schemas/'.length));
    }
    Object.values(value).forEach(visit);
  };
  while (queue.length) {
    const name = queue.pop()!;
    if (Object.hasOwn(schemas, name)) continue;
    expect(manifest.schemas[name], name).toBeDefined();
    schemas[name] = manifest.schemas[name];
    visit(schemas[name]);
  }
  expect(Object.keys(operations)).toHaveLength(53);
  expect(Object.keys(schemas)).toHaveLength(202);
  // Verify the approved context and neutral view deltas before comparing all
  // other operations and reachable schemas to the original release digest.
  const appContext = schemas.AppContext as {
    properties: Record<string, { type?: string; enum?: string[]; description?: string }>;
    required: string[];
  };
  expect(Object.keys(appContext.properties.dataState).sort()).toEqual(['description', 'enum', 'type']);
  expect(appContext.properties.dataState.type).toBe('string');
  expect(appContext.properties.dataState.enum).toEqual(['uninitialized', 'ready']);
  expect(appContext.properties.dataState.description).toContain('APP_DATA_POLICY_DISABLED');
  expect(appContext.required.filter(name => name === 'dataState')).toHaveLength(1);
  const baselineSchemas = structuredClone(schemas);
  const baselineAppContext = baselineSchemas.AppContext as typeof appContext;
  delete baselineAppContext.properties.dataState;
  baselineAppContext.required = baselineAppContext.required.filter(name => name !== 'dataState');
  const baselineOperations = structuredClone(operations);
  expect(baselineOperations.appStreamAccessList.resource).toBe('stream');
  baselineOperations.appStreamAccessList.resource = 'control';
  const access = baselineSchemas.CloudAppStreamAccessItem as {
    properties: {blockedReasons: {items: {enum: string[]}}};
  };
  const reasons = access.properties.blockedReasons.items.enum;
  expect(reasons.filter(reason => reason === 'app_stream_ceiling')).toHaveLength(1);
  expect(reasons).not.toContain('app_control_ceiling');
  access.properties.blockedReasons.items.enum = reasons.map(reason =>
    reason === 'app_stream_ceiling' ? 'app_control_ceiling' : reason);
  const digest = createHash('sha256').update(JSON.stringify(canonical({ operations: baselineOperations, schemas: baselineSchemas }))).digest('hex');
  expect(digest).toBe('c11a131d8a49f573cf7e3eb3bf7bef25994192f81cf37db76d615e99042a1f63');
});
