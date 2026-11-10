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

it('preserves the reviewed business-name Namespace contract with explicit App context and Stream view changes', () => {
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
  expect(Object.keys(schemas)).toHaveLength(198);
  // Verify the approved context and neutral view deltas before comparing all
  // other operations and reachable schemas to the reviewed business-name digest.
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
  const declaration = baselineSchemas.CloudAppCollectionDeclaration as {
    properties: Record<string, unknown>; required: string[];
  };
  expect(declaration.properties.directoryPath).toMatchObject({
    type: 'array', minItems: 1, maxItems: 16,
    items: { type: 'string', minLength: 1, maxLength: 63 },
  });
  expect(declaration.required).not.toContain('directoryPath');
  delete declaration.properties.directoryPath;
  const ensure = baselineOperations.appCollectionsEnsure;
  expect(ensure.description).toContain('New aliases require directoryPath:');
  expect(ensure.description).toContain('Existing aliases keep their current location');
  expect(ensure.description).toContain('never invent a hierarchy');
  ensure.description = ensure.description.split(' New aliases require directoryPath:')[0];
  expect(ensure.example.collections[0].directoryPath).toEqual(['示例工厂', '生产车间']);
  delete ensure.example.collections[0].directoryPath;
  expect(baselineOperations.metadataDeleteOne.description).toBe('软删除将对象移入回收站；删除目录时原子回收整棵有效子树。引用不阻止删除，引用方配置和 Record/Sample 保留；回收期间历史数据按既有授权可读，禁止写入。');
  baselineOperations.metadataDeleteOne.description = '软删除有效对象，执行引用和子节点校验，不级联清除 Record/Sample。';
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
  // app-key-model/1 (Backend 1e6b2d7b6): the 11 fixed App capabilities and the admin-only grant additions.
  const platformPermissions = appContext.properties.platformPermissions as unknown as { items: { enum: string[] }; maxItems: number };
  expect(platformPermissions.items.enum).toEqual(['openapi.base', 'platform.users.read', 'notifications.send', 'asset.file.upload',
    'asset.file.download', 'asset.file.delete', 'stream.requests.read', 'stream.requests.invoke', 'stream.requests.write',
    'stream.messages.publish', 'stream.messages.subscribe']);
  expect(platformPermissions.maxItems).toBe(11);
  expect(operations.appDataPolicyUpdate.description).toContain('app_grant_admin_required');
  const digest = createHash('sha256').update(JSON.stringify(canonical({ operations: baselineOperations, schemas: baselineSchemas }))).digest('hex');
  // Explicitly checked directory declarations above; unrelated Namespace operations stay pinned.
  // Re-pinned for Backend c63783eb4. The digest covers the Namespace operations and their reachable schemas only (the two Edge
  // operations are not part of it); what moved is the base merge: reworded appCollectionsArchive/Restore and metadataDelete*/Restore/
  // BulkWrite descriptions, and name, directoryPath (required), description and ownerAppId on the appCollectionsList item.
  // Re-pinned again for Backend 8780ce2d6 (base 2f79a4f87): the only reachable change is three more ensure schema-note reasons
  // (DIRECTORY_PATH_NOT_APPLIED, TTL_RETAINED, OWNER_APP_TRASHED on CloudAppCollectionSchemaNote, Backend 5d6ae2834).
  // Re-pinned for Backend b6347c688 (app-data-rule-retirement/1): the per-employee rule schemas and the App create hint are gone
  // (four fewer reachable schemas), the rule fields leave the App data policy and the change event, notifications.read leaves
  // AppContext.platformPermissions, and the ensure / recordGet descriptions drop the per-employee wording. From the base: reworded
  // UnsV2FieldOperation.path and a kind description on the generic metadata requests.
  // Re-pinned for Backend 1e6b2d7b6 (app-key-model/1): no reachable schema added or removed; AppContext.platformPermissions is the
  // fixed 11 (stream.messages.publish / subscribe added, new description), appDataPolicyUpdate describes the Owner/Admin-only
  // grant additions, and CloudAppStreamAccessItem.blockedReasons gains a description (app_stream_ceiling = the workspace plan).
  expect(digest).toBe('4d228cdcec45147c485efa1c96679c837bebd0b89cd324e7fc96be9d29f9cc3c');
});
