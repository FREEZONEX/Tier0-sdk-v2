import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertNoRetiredStreamProbe } from './retired-stream-probe.mjs';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url));
const lock = JSON.parse(read('contracts/upstream.json'));
if (!/^[a-f0-9]{40}$/.test(lock.revision)) throw new Error('Uncommitted upstream revision');
for (const [path, expected] of Object.entries(lock.inputs)) {
  assertNoRetiredStreamProbe(read(path).toString('utf8'), path);
  if (createHash('sha256').update(read(path)).digest('hex') !== expected.sha256) throw new Error(`Contract changed without sync: ${path}`);
}
const provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
if (provenance.revision !== lock.revision || provenance.cloudRevision !== lock.revision) throw new Error('UNS provenance differs from Backend lock');
console.log(`Verified committed contract inputs at ${lock.revision}.`);
