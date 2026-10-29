import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNS_V2_CODEC_SCHEMAS, UNS_V2_CONTRACT_PROVENANCE, UNS_V2_OPERATIONS } from '../../src/uns-v2/generated.js';

type Operation = {
  name: string;
  mutation?: string;
  readOnly?: boolean;
  sideEffect?: boolean;
  partialCommit?: boolean;
  appAllowed: boolean;
  coreOnly?: boolean;
  permission: string;
  permissionAnyOf: string[];
  minPermission: number;
};
const read = (file: string) => readFileSync(new URL(`../../contracts/uns-v2/${file}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json')) as {
  operations: Operation[];
  schemas: Record<string, { properties?: Record<string, unknown> }>;
};
const contract = JSON.parse(read('contract.json')) as { operations: Operation[]; schemas: Record<string, unknown> };
const registry = read('registry_generated.go');
const operation = (name: string) => manifest.operations.find(item => item.name === name)!;

describe('Backend App UNS access contract without generic record audit', () => {
  it('pins the exact upstream commit and all generator inputs', () => {
    expect(UNS_V2_CONTRACT_PROVENANCE.revision).toBe('5e11f9c46cbfceecf27ae352882bce3663a0cafa');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudRevision).toBe(UNS_V2_CONTRACT_PROVENANCE.revision);
    for (const [key, file] of Object.entries({ contract: 'contract.json', cloudSupport: 'cloud-support.json', manifest: 'manifest.json', provenance: 'provenance.json', registry: 'registry_generated.go' })) {
      expect(UNS_V2_CONTRACT_PROVENANCE.hashes[key as keyof typeof UNS_V2_CONTRACT_PROVENANCE.hashes]).toBe(
        createHash('sha256').update(read(file)).digest('hex')
      );
    }
    expect(UNS_V2_CONTRACT_PROVENANCE.publicOperationCount).toBe(82);
    expect(UNS_V2_CONTRACT_PROVENANCE.streamOperationCount).toBe(1);
    expect(UNS_V2_CONTRACT_PROVENANCE.manifestOperationCount).toBe(95);
    // Error envelopes are decoded by every operation, although success DTOs do not reference them.
    expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, 'UnsV2ErrorResponse')).toBe(true);
    expect(Object.hasOwn(manifest.schemas, 'UnsV2ErrorResponse')).toBe(true);
  });

  it.each([
    ['catalog', ['uns.read', 'uns.write', 'uns.delete']],
    ['dataAppContext', ['uns.read', 'uns.write', 'uns.delete']],
    ['recordTransactionExecute', ['uns.write', 'uns.delete']],
  ] as const)('%s preserves the upstream resource alternatives without inventing read/manage rights', (name, permissions) => {
    const metadata = operation(name);
    expect(metadata.permissionAnyOf).toEqual(permissions);
    expect(metadata.appAllowed).toBe(true);
    expect(contract.operations.find(item => item.name === name)?.permissionAnyOf).toEqual(permissions);
    const line = registry.split('\n').find(row => row.includes(`Name: "${name}"`));
    expect(line).toContain(`PermissionAnyOf: []string{${permissions.map(permission => `"${permission}"`).join(', ')}}`);
    expect(line).toContain('AppAllowed: true');
    expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
  });

  it('removes every retired compatibility operation from runtime, manifest and registry', () => {
    const retired = ['recordFindOneAndUpdate', 'recordFindOneAndReplace', 'recordFindOneAndDelete', 'recordInsertMany', 'recordDistinct',
      'metadataFindOneAndUpdate', 'metadataFindOneAndReplace', 'metadataFindOneAndDelete', 'metadataFindOne', 'metadataInsertMany', 'metadataDistinct',
      'sourceList', 'sourceGet', 'sourceCreate', 'sourceUpdate', 'sourceConnectionUpdate',
      'streamProgramValidate', 'streamProgramCreate', 'streamProgramUpdate', 'streamProgramGet', 'streamProgramDisable'];
    for (const name of retired) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(false);
      expect(manifest.operations.some(item => item.name === name), name).toBe(false);
      expect(contract.operations.some(item => item.name === name), name).toBe(false);
      expect(registry).not.toContain(`Name: "${name}"`);
    }
    for (const name of ['UnsV2RecordInsertManyReq', 'UnsV2RecordFindOneAndUpdateReq', 'UnsV2MetadataFindOneReq', 'UnsV2SourceCreateReq']) {
      expect(Object.hasOwn(contract.schemas, name), name).toBe(false);
      expect(Object.hasOwn(manifest.schemas, name), name).toBe(false);
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name), name).toBe(false);
    }
  });

  it('marks every operation without a mutation read-only, matching the generated mutation flag', () => {
    // The SDK fills `execution` for failures without an error body from `mutation`: reads rolledBack, writes unknown.
    for (const item of manifest.operations) {
      expect(item.readOnly, item.name).toBe(!item.mutation && !item.sideEffect);
      if (Object.hasOwn(UNS_V2_OPERATIONS, item.name)) {
        expect(UNS_V2_OPERATIONS[item.name as keyof typeof UNS_V2_OPERATIONS].mutation, item.name).toBe(!item.readOnly);
      }
    }
  });

  it('uses the neutral management contract without exposing retired execution aliases or API Key grants', () => {
    expect(operation('streamRequestGrantGet').permission).toBe('stream.requests.manage');
    expect(operation('streamRequestGrantSet').permission).toBe('stream.requests.manage');
    for (const name of ['controlDiscover', 'controlDescribe', 'controlInvoke', 'controlGrantGet', 'controlGrantSet',
      'hostedAppControlPolicyGet', 'hostedAppControlPolicyUpdate']) {
      expect(manifest.operations.some(item => item.name === name), name).toBe(false);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(false);
    }
    const grant = manifest.schemas.CloudStreamRequestGrantSetReq.properties!;
    expect(grant.principalKind).toMatchObject({ enum: ['app', 'user'] });
    expect(Object.hasOwn(UNS_V2_OPERATIONS, 'streamRuntimeCapabilitiesGet')).toBe(false);
    expect(manifest.operations.some(item => item.name === 'streamRuntimeCapabilitiesGet')).toBe(false);
    expect(Object.hasOwn(manifest.schemas, 'CloudStreamRuntimeCapabilitiesGetReq')).toBe(false);
    expect(Object.hasOwn(manifest.schemas, 'CloudStreamRuntimeCapabilitiesGetResponse')).toBe(false);
  });

  it('flags the non-atomic batch writes that can commit partly', () => {
    // The data layer's updateMany / deleteMany rely on these answering execution=committed with cumulative data.
    expect(manifest.operations.filter(item => item.partialCommit).map(item => item.name).sort()).toEqual(
      ['metadataBulkWrite', 'recordBulkWrite', 'recordDeleteMany', 'recordUpdateMany'],
    );
  });

  it('continues updateMany and deleteMany with resumeAfter, the operation batches from nextIndex up to unknownUntil', () => {
    // The data layer sends insertMany / bulkWrite atomic, so it never continues them.
    const carrying = (field: string) =>
      Object.entries(manifest.schemas).filter(([, schema]) => JSON.stringify(schema).includes(`"${field}"`)).map(([name]) => name).sort();
    expect(carrying('resumeAfter')).toEqual([
      'UnsV2RecordDeleteManyReq', 'UnsV2RecordDeleteManyResponse',
      'UnsV2RecordUpdateManyReq', 'UnsV2RecordUpdateManyResponse',
    ]);
    expect(carrying('nextIndex')).toEqual(['UnsV2MetadataBulkWriteResponse', 'UnsV2RecordBulkWriteResponse']);
    // [nextIndex, unknownUntil) is the span whose outcome is unknown; without it, continuing from nextIndex is safe.
    expect(carrying('unknownUntil')).toEqual(['UnsV2MetadataBulkWriteResponse', 'UnsV2RecordBulkWriteResponse']);
  });

  it('narrows App credentials to the 5.0.0 data surface', () => {
    // A9: App keys lose metadataFind*, the jobs query and change polling; records:explain stays (D-9 withdrawn).
    for (const name of ['metadataFind', 'jobs']) {
      expect(operation(name).appAllowed, name).toBe(false);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(true);
    }
    expect(operation('jobs').permissionAnyOf).toEqual(['uns.read', 'uns.write', 'uns.delete']);
    expect(manifest.operations.some(item => item.name === 'recordChangesPoll')).toBe(false);
    for (const name of ['recordExplain', 'recordGet', 'recordQueryBatch', 'recordSubscribe']) {
      expect(operation(name).appAllowed, name).toBe(true);
    }
  });

  it('keeps App credentials outside generic management while preserving owned-collection lifecycle and Core-only boundaries', () => {
    const appCollectionLifecycle = ['appCollectionsArchive', 'appCollectionsEnsure', 'appCollectionsRestore', 'appCollectionsSchemaReplace'];
    const management = manifest.operations.filter(item => item.minPermission >= 3 || item.permission.includes('manage'));
    expect(management.filter(item => item.appAllowed).map(item => item.name).sort()).toEqual(appCollectionLifecycle);
    for (const item of management) {
      expect(item.appAllowed, item.name).toBe(['appCollectionsEnsure', 'appCollectionsSchemaReplace', 'appCollectionsArchive', 'appCollectionsRestore'].includes(item.name));
      expect(item.permissionAnyOf.some(permission => permission.includes('manage')), item.name).toBe(false);
    }
    for (const name of appCollectionLifecycle) {
      expect(operation(name)).toMatchObject({ appAllowed: true, permission: 'uns.write', minPermission: 3 });
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
    }
    // Generic workspace SDK methods remain available; their presence grants no App authority.
    expect(operation('metadataInsertOne').appAllowed).toBe(false);
    expect(Object.hasOwn(UNS_V2_OPERATIONS, 'metadataInsertOne')).toBe(true);
    expect(operation('appCollectionsList').appAllowed).toBe(false);
    expect(Object.hasOwn(UNS_V2_OPERATIONS, 'appCollectionsList')).toBe(true);
    for (const name of ['metadata', 'metaBatchExecute', 'metaBatchValidate', 'directoryCreate', 'directoryGet',
      'directoryList', 'directoryUpdate', 'directoryDelete', 'topicCreate', 'topicGet', 'topicList', 'topicUpdate',
      'topicDelete', 'collectionCreate', 'collectionGet', 'collectionList', 'collectionUpdate',
      'collectionArchive', 'collectionRestore', 'collectionSchemaUpdate', 'topicViewUpdate']) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(false);
    }
    for (const name of ['appDataPolicyGet', 'appDataPolicyUpdate']) {
      expect(operation(name)).toMatchObject({ appAllowed: false, coreOnly: false, permission: 'uns.write', minPermission: 3 });
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
    }
    for (const name of ['appStreamPolicyGet', 'appStreamPolicyUpdate']) {
      expect(operation(name)).toMatchObject({ appAllowed: false, permission: 'stream.requests.manage', minPermission: 3 });
      expect(operation(name).coreOnly).not.toBe(true);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
    }
    for (const name of ['appRegistrationCapabilities', 'appRegistrationList', 'appRegistrationGet',
      'appRegistrationCreate', 'appRegistrationUpdate', 'appRegistrationPermissionsUpdate']) {
      expect(operation(name)).toMatchObject({ appAllowed: false, coreOnly: true });
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(false);
    }
    for (const name of ['appAccessGet', 'appAccessUpdate']) {
      expect(manifest.operations.some(item => item.name === name)).toBe(false);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
    }
  });

  it('retains create capability and source acquisition without generic record audit', () => {
    for (const name of ['CloudAppCreateCapability']) {
      expect(Object.hasOwn(manifest.schemas, name)).toBe(true);
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name)).toBe(true);
    }
    expect(manifest.schemas.CloudAppCreateCapability.properties).toHaveProperty('inputSchema');
    expect(manifest.schemas.CloudAppCreateCapability.properties).toHaveProperty('binding');
    for (const name of ['CloudRecordAuditConfig', 'CloudRecordAuditActor', 'CloudRecordAuditEvent',
      'UnsV2RecordAuditListReq', 'UnsV2RecordAuditListResponse', 'UnsV2RecordAuditAdminListReq', 'UnsV2RecordAuditAdminListResponse']) {
      expect(Object.hasOwn(manifest.schemas, name), name).toBe(false);
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name), name).toBe(false);
    }
    for (const name of ['recordAuditList', 'recordAuditAdminList']) {
      expect(manifest.operations.some(item => item.name === name), name).toBe(false);
      expect(contract.operations.some(item => item.name === name), name).toBe(false);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(false);
      expect(registry).not.toContain(`Name: "${name}"`);
    }
    for (const [name, schema] of Object.entries(manifest.schemas)) {
      if (/collection/i.test(name)) expect(schema.properties ?? {}, name).not.toHaveProperty('audit');
    }
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).toContain('app-create-capability/1');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).not.toContain('record-audit/1');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).toContain('source-bindings/1');
  });
});
