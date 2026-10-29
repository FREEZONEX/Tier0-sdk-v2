import assert from 'node:assert/strict';
import test from 'node:test';
import { platformSchemaProjection } from './platform-schema-projection.mjs';

const ref = name => ({ $ref: `#/components/schemas/${name}` });

test('platform responses retain transitive shared capability definitions and exclude unrelated domains', () => {
  const schemas = {
    PlatformDiscovery: { properties: { capabilities: { items: ref('CapabilityDiscoverycapability') } } },
    CapabilityDiscoverycapability: { allOf: [ref('CapabilityDiscoveryknownCapability')] },
    CapabilityDiscoveryknownCapability: { properties: { operations: { items: ref('CapabilityDiscoveryoperation') } } },
    CapabilityDiscoveryoperation: { properties: { retryAfterMs: { type: 'integer' } } },
    UnrelatedDataDocument: { properties: { private: { type: 'string' } } },
  };
  const actual = platformSchemaProjection(schemas, { response: ref('PlatformDiscovery') });
  assert.deepEqual(Object.keys(actual).sort(), [
    'CapabilityDiscoverycapability', 'CapabilityDiscoveryknownCapability',
    'CapabilityDiscoveryoperation', 'Discovery',
  ].sort());
  assert.deepEqual(actual.CapabilityDiscoveryoperation, schemas.CapabilityDiscoveryoperation);
  assert.deepEqual(actual.Discovery, schemas.PlatformDiscovery);
});

test('recursive references close without dropping their definitions', () => {
  const schemas = { PlatformTree: { properties: { children: { items: ref('PlatformTree') } } } };
  assert.deepEqual(platformSchemaProjection(schemas, { response: ref('PlatformTree') }), { Tree: schemas.PlatformTree });
});

test('missing references and ambiguous stable names fail before generating output', () => {
  assert.throws(() => platformSchemaProjection({}, ref('Missing')), /Unknown schema: Missing/);
  assert.throws(() => platformSchemaProjection({
    PlatformShared: { type: 'string' }, Shared: { type: 'integer' },
  }, [ref('PlatformShared'), ref('Shared')]), /schema name collision/);
});
