import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Add one range operation and only its new schemas. Never replace shared
// Source/Stream schemas or the preceding transaction overlays.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref, 'Usage: sync-atomic-range-update.mjs <backend> <commit|--worktree>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const preview = ref === '--worktree';
const revision = git('rev-parse', `${preview ? 'HEAD' : ref}^{commit}`).toString().trim();
const upstream = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const local = path => readFileSync(resolve(root, path));
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const name = 'recordUpdateManyAtomic';
const scope = 'record-atomic-range-update';
const route = '/uns/records:updateManyAtomic';
const lock = JSON.parse(local('contracts/upstream.json'));
const provenance = JSON.parse(local('contracts/uns-v2/provenance.json'));
assert.deepEqual(provenance.schemaUpdates || [], lock.schemaUpdates || [], 'Incremental schema provenance differs');
const previous = provenance.schemaUpdates?.find(item => item.scope === scope);
assert.ok(!previous || provenance.schemaUpdates.at(-1) === previous, 'Resync later overlays before replacing a nonterminal overlay');
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision,
  sourceKind: preview ? 'working-tree-preview' : 'committed', inputs: {}, operations: [name], schemas: [], paths: [route] };
const paths = {
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
  'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
  'contracts/uns-v2/registry_generated.go': 'share/unscontract/registry_generated.go',
};
const outputs = new Map(), schemas = new Set();
function mergeNewSchemas(current, incoming, roots, replaceable = new Set()) {
  const pending = [...roots], seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref?.startsWith('#/components/schemas/')) pending.push(value.$ref.split('/').at(-1));
    Object.values(value).forEach(visit);
  }
  while (pending.length) {
    const item = pending.pop();
    if (typeof item !== 'string') { visit(item); continue; }
    if (seen.has(item)) continue;
    seen.add(item);
    assert.ok(incoming[item], `Missing Backend schema ${item}`);
    if (current[item] && !replaceable.has(item)) assert.deepEqual(current[item], incoming[item], `Shared schema ${item} differs; a separate reviewed overlay is required`);
    else { current[item] = structuredClone(incoming[item]); schemas.add(item); }
    visit(incoming[item]);
  }
}
for (const [path, sourcePath] of Object.entries(paths)) {
  const before = local(path), raw = upstream(sourcePath);
  assert.equal(digest(before), lock.inputs[path].sha256, `Unsynced input ${path}`);
  let after;
  if (path.endsWith('.go')) {
    const row = raw.toString().split('\n').filter(line => line.includes(`{Name: "${name}"`));
    assert.equal(row.length, 1, 'Backend registry must define exactly one atomic range operation');
    const text = before.toString().split('\n').filter(line => !line.includes(`{Name: "${name}"`)).join('\n');
    assert.ok(/\n}\s*$/.test(text), 'Unexpected registry shape');
    after = Buffer.from(text.replace(/\n}(\s*)$/, `\n${row[0].replace(/\r$/, '')}\n}$1`));
  } else {
    const current = JSON.parse(before);
    const incoming = path.endsWith('/contract.json')
      ? JSON.parse(JSON.parse(raw.toString().match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m)[1]))
      : JSON.parse(raw);
    const replaceable = new Set(previous?.schemas ?? []);
    if (path.endsWith('openapi-v2.source.json')) {
      const operation = incoming.paths[route];
      assert.equal(operation?.post?.operationId, 'UnsV2RecordUpdateManyAtomic');
      assert.deepEqual(Object.keys(operation), ['post']);
      current.paths[route] = structuredClone(operation);
      mergeNewSchemas(current.components.schemas, incoming.components.schemas, [operation], replaceable);
    } else {
      const operations = incoming.operations.filter(item => item.name === name);
      assert.equal(operations.length, 1);
      const operation = operations[0];
      assert.equal(operation.appAllowed, true); assert.equal(operation.permission, 'uns.write');
      assert.equal(operation.method, 'POST'); assert.equal(operation.suffix, route);
      assert.notEqual(operation.partialCommit, true);
      current.operations = [...current.operations.filter(item => item.name !== name), structuredClone(operation)];
      mergeNewSchemas(current.schemas, incoming.schemas, [operation.request, operation.response], replaceable);
      if (incoming.cloudContractRevision) update.sourceContractRevision = incoming.cloudContractRevision;
    }
    after = path.endsWith('/contract.json') ? Buffer.from(JSON.stringify(current) + '\n') : json(current);
  }
  outputs.set(path, after);
  update.inputs[path] = { path: sourcePath, sourceSHA256: digest(raw),
    baseSHA256: previous?.inputs[path]?.baseSHA256 ?? digest(before), resultSHA256: digest(after) };
  lock.inputs[path] = { ...lock.inputs[path], sha256: digest(after) };
}
update.schemas = [...schemas].sort();
const updates = (provenance.schemaUpdates || []).filter(item => item.scope !== scope);
updates.push(update); provenance.schemaUpdates = updates; lock.schemaUpdates = updates;
provenance.sourceDerivedContractSHA256 = digest(outputs.get('contracts/uns-v2/contract.json'));
outputs.set('contracts/upstream.json', json(lock)); outputs.set('contracts/uns-v2/provenance.json', json(provenance));
for (const [path, data] of outputs) writeFileSync(resolve(root, path), data);
console.log(`Synced ${name} at ${revision} (${update.sourceKind}); ${schemas.size} new schemas, prior overlays retained.`);
