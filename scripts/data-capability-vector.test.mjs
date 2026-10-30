import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dataCapabilityVector } from './data-capability-vector.mjs';

const vectors = JSON.parse(readFileSync(new URL('../contracts/capability-discovery/vectors.json', import.meta.url)));

test('uses the exact neutral shared contract and the recorded consumer implementation', () => {
  const provenance = JSON.parse(readFileSync(new URL('../contracts/capability-discovery/provenance.json', import.meta.url)));
  for (const path of ['contracts/capability-discovery/response.schema.json', 'contracts/capability-discovery/vectors.json', 'src/capabilities.ts']) {
    const bytes = readFileSync(new URL('../' + path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.inputs[path], path);
  }
  assert.deepEqual(provenance.consumerScope, ['namespace.v2', 'source', 'stream']);
});

test('preserves all shared verdicts and isolates the 24 request-only consumer differences', () => {
  const original = JSON.stringify(vectors);
  const projections = vectors.map(dataCapabilityVector);
  assert.equal(vectors.length, 210);
  assert.equal(projections.filter(item => item.unconsumedRequestSemantics).length, 24);
  assert.equal(projections.filter(item => !item.consumerValid).length, vectors.filter(item => !item.valid).length - 24);
  for (let i = 0; i < vectors.length; i++) {
    if (!projections[i].unconsumedRequestSemantics) assert.equal(projections[i].consumerValid, vectors[i].valid);
    assert.ok(projections[i].expected.capabilities.every(item => ['namespace.v2', 'source', 'stream'].includes(item.code)));
  }
  assert.equal(JSON.stringify(vectors), original);
});

test('never exempts a core capability hidden under a request-only vector name', () => {
  const vector = structuredClone(vectors.find(item => item.name === 'cloud-stream.requests.v1-versions-empty'));
  assert.ok(vector);
  vector.response.capabilities.push({ code: 'stream', contractVersions: [] });
  assert.throws(() => dataCapabilityVector(vector), /never hide malformed core/);
});
