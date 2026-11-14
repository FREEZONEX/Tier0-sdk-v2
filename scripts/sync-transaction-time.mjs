import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Add only the optional clock result or its ISO binding format. Preserve all
// earlier Source/Stream and transaction overlays and their provenance chain.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref, mode] = process.argv.slice(2);
assert.ok(backend && ref && (mode === undefined || mode === '--format'), 'Usage: sync-transaction-time.mjs <backend> <commit|--worktree> [--format]');
const format = mode === '--format';
const property = format ? 'format' : 'transactionTime';
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const preview = ref === '--worktree';
const revision = git('rev-parse', `${preview ? 'HEAD' : ref}^{commit}`).toString().trim();
const upstream = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const local = path => readFileSync(resolve(root, path));
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const lock = JSON.parse(local('contracts/upstream.json'));
const provenance = JSON.parse(local('contracts/uns-v2/provenance.json'));
assert.deepEqual(provenance.schemaUpdates || [], lock.schemaUpdates || [], 'Incremental schema provenance differs');
const scope = format ? 'record-transaction-time-format' : 'record-transaction-time';
const previous = provenance.schemaUpdates?.find(item => item.scope === scope);
assert.ok(!previous || provenance.schemaUpdates.at(-1) === previous, 'Resync later overlays before replacing a nonterminal overlay');
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision,
  sourceKind: preview ? 'working-tree-preview' : 'committed', inputs: {}, schemas: [format ? 'UnsV2ResultBinding.format' : 'Result.transactionTime'] };
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
  const schemaName = format ? 'UnsV2ResultBinding' : path.endsWith('openapi-v2.source.json') ? 'DocUnsV2RecordTransactionExecuteResult' : 'Result';
  const source = (incoming.schemas ?? incoming.components.schemas)[schemaName];
  const target = (current.schemas ?? current.components.schemas)[schemaName];
  assert.ok(source.properties[property] && !source.required?.includes(property), 'Clock additions must be optional for older servers');
  if (expected) assert.deepEqual(source.properties[property], expected, 'Backend transaction-time schemas disagree');
  expected = source.properties[property];
  assert.equal(expected.type, format ? 'string' : 'integer');
  if (format) assert.deepEqual(expected.enum, ['iso8601']);
  target.properties[property] = structuredClone(expected);
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
