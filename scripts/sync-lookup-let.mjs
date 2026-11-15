import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synchronize only lookup variables; retain earlier reviewed contract overlays.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref, 'Usage: sync-lookup-let.mjs <backend> <commit|--worktree>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const preview = ref === '--worktree';
const revision = git('rev-parse', `${preview ? 'HEAD' : ref}^{commit}`).toString().trim();
const upstream = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const local = path => readFileSync(resolve(root, path));
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const lock = JSON.parse(local('contracts/upstream.json'));
const provenance = JSON.parse(local('contracts/uns-v2/provenance.json'));
assert.deepEqual(provenance.schemaUpdates || [], lock.schemaUpdates || []);
const scope = 'lookup-let-variables';
const previous = provenance.schemaUpdates?.find(item => item.scope === scope);
assert.ok(!previous || provenance.schemaUpdates.at(-1) === previous, 'Cannot replace a nonterminal overlay');
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision,
  sourceKind: preview ? 'working-tree-preview' : 'committed', inputs: {}, schemas: ['UnsV2PipelineStage.$lookup.let'] };
const sourcePaths = {
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
  'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
};
const outputs = new Map();
let expected;
for (const [path, sourcePath] of Object.entries(sourcePaths)) {
  const before = local(path);
  assert.equal(digest(before), lock.inputs[path].sha256, `Unsynced input ${path}`);
  const raw = upstream(sourcePath);
  const incoming = path.endsWith('/contract.json')
    ? JSON.parse(JSON.parse(raw.toString().match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m)[1]))
    : JSON.parse(raw);
  const current = JSON.parse(before);
  const lookup = document => (document.schemas ?? document.components.schemas).UnsV2PipelineStage.oneOf.find(stage => stage.properties?.$lookup).properties.$lookup;
  const binding = lookup(incoming).properties.let;
  assert.equal(binding.type, 'object');
  assert.equal(binding.maxProperties, 16);
  assert.deepEqual(binding.additionalProperties, { $ref: '#/components/schemas/UnsV2PipelineExpression' });
  if (expected) assert.deepEqual(binding, expected, 'Backend lookup-variable contracts disagree');
  expected = binding;
  const withoutBindings = value => {
    const copy = structuredClone(value);
    delete copy.properties.let;
    return copy;
  };
  assert.deepEqual(withoutBindings(lookup(incoming)), withoutBindings(lookup(current)), 'This overlay must only add lookup variables');
  lookup(current).properties.let = structuredClone(binding);
  const after = path.endsWith('/contract.json') ? Buffer.from(JSON.stringify(current) + '\n') : json(current);
  outputs.set(path, after);
  update.inputs[path] = { path: sourcePath, sourceSHA256: digest(raw),
    baseSHA256: previous?.inputs[path]?.baseSHA256 ?? digest(before), resultSHA256: digest(after) };
  lock.inputs[path] = { ...lock.inputs[path], sha256: digest(after) };
}
const updates = (provenance.schemaUpdates || []).filter(item => item.scope !== scope);
updates.push(update);
provenance.schemaUpdates = updates;
lock.schemaUpdates = updates;
provenance.sourceDerivedContractSHA256 = digest(outputs.get('contracts/uns-v2/contract.json'));
outputs.set('contracts/upstream.json', json(lock));
outputs.set('contracts/uns-v2/provenance.json', json(provenance));
for (const [path, data] of outputs) writeFileSync(resolve(root, path), data);
console.log(`Synced ${scope} at ${revision} (${update.sourceKind}).`);
