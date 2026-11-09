import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Import the reviewed run/observation DTOs and their dependencies without adding operations.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref, 'Usage: sync-stream-diagnostics.mjs <backend> <commit>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const revision = git('rev-parse', `${ref}^{commit}`).toString().trim();
const read = path => readFileSync(resolve(root, path), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const lock = JSON.parse(read('contracts/upstream.json'));
const provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
const local = 'contracts/uns-v2/manifest.json', source = 'share/unscontract/manifest.json';
const before = read(local), raw = git('show', `${revision}:${source}`).toString();
assert.equal(hash(before), lock.inputs[local].sha256, 'Unsynced manifest input');
const current = JSON.parse(before), upstream = JSON.parse(raw);
const names = new Set();
const pending = ['CloudStreamRunsListResponse', 'CloudStreamObservationGetResponse', 'CloudStreamRunError'];
function refs(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref?.startsWith('#/components/schemas/')) pending.push(value.$ref.split('/').at(-1));
  Object.values(value).forEach(refs);
}
while (pending.length) {
  const name = pending.pop();
  if (names.has(name)) continue;
  assert.ok(upstream.schemas[name], `Missing upstream schema ${name}`);
  names.add(name);
  current.schemas[name] = upstream.schemas[name];
  refs(upstream.schemas[name]);
}
const after = JSON.stringify(current, null, 2) + '\n';
const previous = lock.schemaUpdates?.find(item => item.scope === 'stream-diagnostics');
const update = { scope: 'stream-diagnostics', repository: 'FREEZONEX/Tier0-Backend', revision,
  sourceKind: 'committed', schemas: [...names].sort(), inputs: { [local]: {
    path: source, sourceSHA256: hash(raw), baseSHA256: previous?.inputs[local]?.baseSHA256 ?? hash(before), resultSHA256: hash(after),
  } } };
lock.inputs[local].sha256 = hash(after);
lock.schemaUpdates = [...(lock.schemaUpdates || []).filter(item => item.scope !== update.scope), update];
provenance.schemaUpdates = lock.schemaUpdates;
writeFileSync(resolve(root, local), after);
for (const [path, value] of [['contracts/upstream.json', lock], ['contracts/uns-v2/provenance.json', provenance]]) {
  writeFileSync(resolve(root, path), JSON.stringify(value, null, 2) + '\n');
}
console.log(`Synced ${names.size} Stream diagnostic schemas at ${revision}; operations unchanged.`);
