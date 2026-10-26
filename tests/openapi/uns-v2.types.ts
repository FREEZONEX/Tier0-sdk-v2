import {
  createClient,
  type IndexSpec,
  type RuntimeStreamDefinition,
  type CloudAppCreateCapability,
  UnsV2RawNumber,
  type components,
  type UnsV2JSONValue,
  type UnsV2OperationName,
  type UnsV2Request,
  type UnsV2Response,
} from '../../src/index.js';

const client = createClient({ apiHost: 'https://example.invalid', apiKey: 'workspace-bound' });
// Native runtime DTO from the pinned source; hosted Cloud documents retain their own shape.
const nativeDefinition: RuntimeStreamDefinition = {
  name: 'native-http', script: '', sdkVersion: 'tier0-stream/v2',
  sourceBindings: [{ sourceId: '101', configRevision: new UnsV2RawNumber('9007199254740993'), acquisition: {} }],
};
const invalidBinding: NonNullable<RuntimeStreamDefinition['sourceBindings']>[number] = {
  sourceId: '101', acquisition: {},
  // @ts-expect-error Native binding revision must be an exact integer, not a string.
  configRevision: '2',
};
// @ts-expect-error Each native binding requires protocol acquisition parameters.
const missingAcquisition: NonNullable<RuntimeStreamDefinition['sourceBindings']>[number] = { sourceId: '101', configRevision: 2 };
void [nativeDefinition, invalidBinding, missingAcquisition];
const ownAppContext = client.uns.dataAppContext({});
const createHint: CloudAppCreateCapability = { version: 'cloud-app-create-capability/v1', allowed: true, reason: 'allowed',
  appRevision: 19, collectionRevision: new UnsV2RawNumber('9007199254740993'), binding: 'a'.repeat(64),
  inputSchema: { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'integer' } } } };
const currentCreateHint = ownAppContext.then(response => {
  const capability: CloudAppCreateCapability | undefined = response.data.collections[0].createCapability;
  return capability?.inputSchema;
});
// @ts-expect-error An unknown capability version cannot be assumed compatible.
const unknownCreateHint: CloudAppCreateCapability = { ...createHint, version: 'cloud-app-create-capability/v2' };
// @ts-expect-error A binding is not a create credential or a business field.
client.uns.recordInsertOne({ collectionId: 'orders', data: {}, binding: createHint.binding });
void [createHint, currentCreateHint, unknownCreateHint];
void ownAppContext;
const inserted = client.uns.recordInsertOne({ collectionId: 'orders', data: { code: 'A' }, returnDocument: 'after', projection: { code: 1 } });
inserted.then(response => {
  const id: string = response.data.insertedId;
  const revision = response.data.value?.revision;
  void [id, revision];
});
// @ts-expect-error insert has no previous document
client.uns.recordInsertOne({ collectionId: 'orders', data: {}, returnDocument: 'before' });
const list = client.uns.recordFind({ collectionId: 'orders', limit: 20, cursor: 'opaque' });
const jobs = client.uns.jobs({ queries: [{ queryId: 'job', jobIds: ['job-1'] }] });
const transaction = client.uns.recordTransactionExecute({ items: [] });
const sources = client.source.documents.list({ page: 1, size: 20, archived: false });
const deployment = client.stream.programs.deploy({
  id: 'stream-1', dryRun: false, expectedRevision: 3, expectedSourceRevision: 7, idempotencyKey: 'deploy-1',
});
const scopedSamples = client.uns.sampleFind({ collectionId: 'measurements', recordIds: ['machine-1'], from: 0, to: 1000, page: { mode: 'cursor', size: 20 } });
const sourceState = client.source.state.update({
  dryRun: false, items: [{ id: '101', expectedRevision: 2, desiredState: 'enabled', confirmedImpactRevision: 'reviewed-confirmation' }],
});
const sourceDelete = client.source.delete({ dryRun: true, items: [{ id: '101', expectedRevision: 2, confirmedImpactRevision: 'reviewed-confirmation' }] });
const sourceImpact = client.source.impact({ id: '101', expectedRevision: 2, action: 'disable', size: 20 });
const sourceHistory = client.source.history({ id: '101', size: 20 });
const observations = client.source.observations.get({ items: [{ id: '101', expectedRevision: 2 }] });
const streamObservation = client.stream.observations.get({ id: '202' });
const runs = client.stream.runs.list({ id: '202', size: 20, cursor: 'opaque' });
const documentValidation = client.stream.documents.validate({ document: {
  name: 'collector', model: 'collection',
  script: { sdkVersion: 'tier0-stream/v2', code: 'module.exports = api => api;', timeoutMs: 1_000 },
  sources: [{ alias: 'plant', sourceId: 'source-1', configRevision: 2, resources: ['line/1'] }],
} });
const operation: UnsV2OperationName = 'recordInsertOne';
const singleIndex: IndexSpec = { path: 'serial', unique: true };
const compositeIndex: IndexSpec = { paths: ['plant', 'serial'], kind: 'btree', target: 'records', unique: true };
// @ts-expect-error IndexSpec requires one path declaration.
const missingIndexPath: IndexSpec = { unique: true };
// @ts-expect-error Single and composite declarations are mutually exclusive.
const ambiguousIndexPath: IndexSpec = { path: 'serial', paths: ['serial'] };
void [singleIndex, compositeIndex, missingIndexPath, ambiguousIndexPath];
const request: UnsV2Request<'metadataFind'> = { kind: 'directory', filter: { _id: 'directory-1' } };
type MetadataFindResponse = UnsV2Response<'metadataFind'>;
const exactInt64: components['schemas']['PlatformGetMembersReq'] = { page: 9_223_372_036_854_775_807n };
const exactBusinessNumber: UnsV2JSONValue = new UnsV2RawNumber('1.0000000000000001');
void [list, jobs, transaction, sources, deployment, scopedSamples, sourceState, sourceDelete, sourceImpact, sourceHistory, documentValidation,
  observations, streamObservation, runs, operation, request, exactInt64, exactBusinessNumber, null as MetadataFindResponse | null];

// @ts-expect-error core-only graph has no Gateway route and is not exposed by the SDK.
client.uns.graph({ queries: [] });
// @ts-expect-error Credential creation is Core-only and has no public Gateway route.
client.source.credentials.create({});
// @ts-expect-error Ingress discovery is Core-only and has no public Gateway route.
client.source.ingress.get({ id: '101' });
// @ts-expect-error Ingress rotation is Core-only and has no public Gateway route.
client.source.ingress.rotate({ id: '101' });
// @ts-expect-error identity and workspace binding cannot be supplied through list request DTOs.
client.uns.metadataFind({ workspaceId: 'other-workspace' });
// Unreferenced Source mutations need only the existing revision; referenced sources require server-side review.
client.source.delete({ dryRun: false, items: [{ id: '101', expectedRevision: 2 }] });
client.source.documents.update({ dryRun: false, id: '101', expectedRevision: 2, patch: { name: 'renamed' } });
client.source.state.update({ dryRun: false, items: [{ id: '101', expectedRevision: 2, desiredState: 'enabled' }] });

const lease = client.uns.recordLock({ collectionId: 'orders', ids: ['order-1'], ttlMs: 30000 });
const unlock = client.uns.recordUnlock({ collectionId: 'orders', locks: [{ id: 'order-1', token: 'lease' }] });
const restore = client.uns.recordRestore({ collectionId: 'orders', ids: ['order-1'], idempotencyKey: 'restore-1' });
void [lease, unlock, restore];
// @ts-expect-error Generic record audit is removed from the public SDK.
client.uns.recordAuditList({ collectionId: 'orders', recordId: 'order-1' });
// @ts-expect-error Generic admin record audit is removed from the public SDK.
client.uns.recordAuditAdminList({ collectionId: 'orders', recordId: 'order-1' });
// @ts-expect-error Removed audit operations cannot be selected through the generic contract.
const removedAuditOperation: UnsV2OperationName = 'recordAuditList';
// @ts-expect-error Removed admin audit operations have no request DTO.
type RemovedAdminAuditRequest = UnsV2Request<'recordAuditAdminList'>;
// @ts-expect-error Replaced collection mutations are no longer exposed alongside metadata CRUD.
client.uns.collectionUpdate({ dryRun: true, items: [] });
// @ts-expect-error The retired metadata batch route must not remain callable.
client.uns.metaBatchExecute({ items: [] });
void [removedAuditOperation, null as RemovedAdminAuditRequest | null];
// @ts-expect-error Retired Cloud batch-query route must not silently map to another contract.
client.uns.records({ queries: [] });
// @ts-expect-error Retired recordCreate is replaced by explicit recordInsertOne/bulkWrite operations.
client.uns.recordCreate({ collectionId: 'orders', items: [] });

const resourceShape = list.then(response => {
  const id: string = response.data.items[0].id;
  const business: Record<string, UnsV2JSONValue> = response.data.items[0].data;
  // @ts-expect-error Query-language aliases are not ordinary resource response fields.
  response.data.items[0]._meta;
  return { id, business };
});
const insertedShape = client.uns.recordInsertOne({ collectionId: 'orders', data: { total: 10 } }).then(response => {
  const id: string = response.data.insertedId;
  // @ts-expect-error insertOne returns one ID; counters belong to batch writes.
  response.data.insertedCount;
  return id;
});
void [resourceShape, insertedShape];

// Change events go through the SSE reader, never a generated method.
// @ts-expect-error records/changes polling was removed in contract 5.0.0
void client.uns.recordChangesPoll;
// Records by ID: missing IDs are listed, never distinguished as absent or hidden.
client.uns.recordGet({ collectionId: 'orders', ids: ['o-1'] }).then(result => {
  const missing: string[] = result.data.missing;
  void missing;
});

// Deprecated wire aliases are absent even from the raw public contract.
type RetiredOperations = 'recordInsertMany' | 'recordDistinct' | 'recordFindOneAndUpdate' | 'recordFindOneAndReplace' | 'recordFindOneAndDelete'
  | 'metadataFindOne' | 'metadataInsertMany' | 'metadataDistinct' | 'metadataFindOneAndUpdate' | 'metadataFindOneAndReplace' | 'metadataFindOneAndDelete'
  | 'sourceList' | 'sourceGet' | 'sourceCreate' | 'sourceUpdate' | 'sourceConnectionUpdate'
  | 'streamProgramCreate' | 'streamProgramGet' | 'streamProgramUpdate' | 'streamProgramValidate' | 'streamProgramDisable';
type AssertRetired<T extends true> = T;
type NoRetiredOperations = AssertRetired<Extract<UnsV2OperationName, RetiredOperations> extends never ? true : false>;
void (null as NoRetiredOperations | null);
