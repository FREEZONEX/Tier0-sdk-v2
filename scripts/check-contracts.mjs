import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { assertNoRetiredStreamProbe } from './retired-stream-probe.mjs';
import { assertNoRetiredHTTPPush } from './retired-http-push.mjs';
import { assertNoRetiredControls } from './retired-controls.mjs';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url));
const lock = JSON.parse(read('contracts/upstream.json'));
if (!/^[a-f0-9]{40}$/.test(lock.revision)) throw new Error('Uncommitted upstream revision');
if (process.argv.includes('--committed') && [lock.sourceKind, lock.platformSource?.sourceKind].includes('working-tree-preview')) {
  throw new Error('Publish requires re-syncing contracts from the committed Backend revision. This snapshot is a working-tree preview.');
}
if (process.argv.includes('--committed')) {
  const capability = JSON.parse(read('contracts/capability-discovery/provenance.json'));
  if (capability.sourceKind === 'working-tree-preview') throw new Error('Capability discovery is a working-tree preview; sync its committed Backend contract before publishing.');
}
for (const [path, expected] of Object.entries(lock.inputs)) {
  assertNoRetiredStreamProbe(read(path).toString('utf8'), path);
  assertNoRetiredHTTPPush(read(path).toString('utf8'), path);
  assertNoRetiredControls(read(path).toString('utf8'), path);
  if (createHash('sha256').update(read(path)).digest('hex') !== expected.sha256) throw new Error(`Contract changed without sync: ${path}`);
}
const provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
if (provenance.revision !== lock.revision || provenance.cloudRevision !== lock.revision) throw new Error('UNS provenance differs from Backend lock');
assert.deepEqual(provenance.schemaUpdates || [], lock.schemaUpdates || [], 'Incremental schema provenance differs');
const latestSchemaInputs = new Map();
for (const update of lock.schemaUpdates || []) {
  assert.match(update.revision, /^[a-f0-9]{40}$/);
  if (process.argv.includes('--committed') && update.sourceKind === 'working-tree-preview') throw new Error('Scoped schema update is a working-tree preview; sync its committed Backend revision before publishing.');
  for (const [path, input] of Object.entries(update.inputs)) {
    assert.match(input.sourceSHA256, /^[a-f0-9]{64}$/);
    latestSchemaInputs.set(path, input);
  }
}
for (const [path, input] of latestSchemaInputs) assert.equal(input.resultSHA256, lock.inputs[path].sha256, `Incremental input differs: ${path}`);
console.log(`Verified data contract inputs at ${lock.revision}; platform ${lock.platformSource?.sourceKind ?? lock.sourceKind ?? 'committed'} at ${lock.platformSource?.revision ?? lock.revision}.`);
