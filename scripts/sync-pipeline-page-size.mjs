import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synchronize only aggregate page size; retain the existing scoped provenance chain.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref, 'Usage: sync-pipeline-page-size.mjs <backend> <commit|--worktree>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const preview = ref === '--worktree';
const revision = git('rev-parse', `${preview ? 'HEAD' : ref}^{commit}`).toString().trim();
const upstream = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const read = path => readFileSync(resolve(root, path));
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const lock = JSON.parse(read('contracts/upstream.json'));
const provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
assert.deepEqual(lock.schemaUpdates, provenance.schemaUpdates);
const scope = 'aggregate-page-size';
const previous = lock.schemaUpdates?.find(item => item.scope === scope);
assert.ok(!previous || lock.schemaUpdates.at(-1) === previous, 'Cannot replace a nonterminal overlay');
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision,
  sourceKind: preview ? 'working-tree-preview' : 'committed', schemas: ['UnsV2PipelinePage.properties.size'], inputs: {} };
const sources = {
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
  'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
};
const outputs = new Map();
for (const [path, sourcePath] of Object.entries(sources)) {
  const before = read(path);
  assert.equal(digest(before), lock.inputs[path].sha256, `Unsynced input ${path}`);
  const raw = upstream(sourcePath);
  const incoming = path.endsWith('/contract.json')
    ? JSON.parse(JSON.parse(raw.toString().match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m)[1]))
    : JSON.parse(raw);
  const current = JSON.parse(before);
  const source = (incoming.schemas ?? incoming.components.schemas).UnsV2PipelinePage?.properties?.size;
  const target = (current.schemas ?? current.components.schemas).UnsV2PipelinePage;
  assert.ok(source && target?.properties?.size, `Missing pipeline page size in ${path}`);
  assert.equal(source.type, 'integer');
  assert.equal(source.minimum, 1);
  assert.equal(source.default, 20);
  assert.equal(source.maximum, undefined);
  target.properties.size = structuredClone(source);
  const after = path.endsWith('/contract.json') ? Buffer.from(JSON.stringify(current) + '\n') : json(current);
  outputs.set(path, after);
  update.inputs[path] = { path: sourcePath, sourceSHA256: digest(raw),
    baseSHA256: previous?.inputs[path]?.baseSHA256 ?? digest(before), resultSHA256: digest(after) };
  lock.inputs[path] = { ...lock.inputs[path], sha256: digest(after) };
}
lock.schemaUpdates = [...(lock.schemaUpdates ?? []).filter(item => item.scope !== scope), update];
provenance.schemaUpdates = lock.schemaUpdates;
provenance.sourceDerivedContractSHA256 = digest(outputs.get('contracts/uns-v2/contract.json'));
outputs.set('contracts/upstream.json', json(lock));
outputs.set('contracts/uns-v2/provenance.json', json(provenance));
for (const [path, data] of outputs) writeFileSync(resolve(root, path), data);
console.log(`Synced ${scope} at ${revision} (${update.sourceKind}).`);
