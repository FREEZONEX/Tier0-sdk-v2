import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sync this one request boundary without changing previously committed query contracts.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref, 'Usage: sync-app-collection-capacity.mjs <backend> <commit|--worktree>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const preview = ref === '--worktree', revision = git('rev-parse', `${preview ? 'HEAD' : ref}^{commit}`).toString().trim();
const upstream = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const read = path => readFileSync(resolve(root, path)), digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const lock = JSON.parse(read('contracts/upstream.json')), provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
assert.deepEqual(lock.schemaUpdates, provenance.schemaUpdates);
const scope = 'app-collection-capacity', schema = 'CloudAppCollectionsEnsureReq';
const previous = lock.schemaUpdates?.find(item => item.scope === scope);
assert.ok(!previous || lock.schemaUpdates.at(-1) === previous, 'Cannot replace a nonterminal overlay');
const implementationPath = 'service/unssvr/internal/domain/unsv2/app_collections.go', implementation = upstream(implementationPath);
for (const name of ['appCollectionsPerApp', 'appIndexesPerApp']) assert.match(implementation.toString(), new RegExp(`\\b${name}\\s*=\\s*128\\b`));
assert.match(implementation.toString(), /\bappArchivedCollectionsPerApp\s*=\s*64\b/);
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision, sourceKind: preview ? 'working-tree-preview' : 'committed',
  schemas: [`${schema}.collections`], implementation: { path: implementationPath, sha256: digest(implementation) }, inputs: {} };
const sources = {
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
};
const outputs = new Map();
for (const [path, sourcePath] of Object.entries(sources)) {
  const before = read(path); assert.equal(digest(before), lock.inputs[path].sha256, `Unsynced input ${path}`);
  const raw = upstream(sourcePath), incoming = path.endsWith('/contract.json')
    ? JSON.parse(JSON.parse(raw.toString().match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m)[1])) : JSON.parse(raw);
  const current = JSON.parse(before), schemas = document => document.schemas ?? document.components.schemas;
  const source = schemas(incoming)[schema], target = schemas(current)[schema];
  assert.equal(source.properties.collections.maxItems, 128);
  // Quota work cannot silently pull in another protocol change.
  const comparison = structuredClone(source.properties.collections); comparison.maxItems = target.properties.collections.maxItems;
  assert.deepEqual(comparison, target.properties.collections);
  target.properties.collections = structuredClone(source.properties.collections);
  const after = path.endsWith('/contract.json') ? Buffer.from(JSON.stringify(current) + '\n') : json(current);
  outputs.set(path, after);
  update.inputs[path] = { path: sourcePath, sourceSHA256: digest(raw), baseSHA256: previous?.inputs[path]?.baseSHA256 ?? digest(before), resultSHA256: digest(after) };
  lock.inputs[path] = { ...lock.inputs[path], sha256: digest(after) };
}
lock.schemaUpdates = [...(lock.schemaUpdates ?? []).filter(item => item.scope !== scope), update];
provenance.schemaUpdates = lock.schemaUpdates;
provenance.sourceDerivedContractSHA256 = digest(outputs.get('contracts/uns-v2/contract.json'));
outputs.set('contracts/upstream.json', json(lock)); outputs.set('contracts/uns-v2/provenance.json', json(provenance));
for (const [path, data] of outputs) writeFileSync(resolve(root, path), data);
console.log(`Synced ${scope} at ${revision} (${update.sourceKind}).`);
