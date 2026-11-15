import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 从正式提交核验完整有效合同后，合并连续的预览来源；不改写运行时 schema。
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, revision] = process.argv.slice(2);
assert.ok(backend && /^[a-f0-9]{40}$/.test(revision ?? ''), 'Usage: sync-app-data-query-contract.mjs <backend> <full-commit-sha>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
assert.equal(git('rev-parse', `${revision}^{commit}`).toString().trim(), revision);
const read = path => readFileSync(resolve(root, path));
const hash = value => createHash('sha256').update(value).digest('hex');
const lock = JSON.parse(read('contracts/upstream.json'));
const provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
assert.deepEqual(lock.schemaUpdates, provenance.schemaUpdates, 'Contract provenance differs');
for (const [path, entry] of Object.entries(lock.inputs)) assert.equal(hash(read(path)), entry.sha256, `Unsynced input ${path}`);

const scope = 'app-data-query-extensions';
const previewScopes = ['record-transaction-json-string', 'record-transaction-capacity', 'string-pattern-predicates', 'ordered-first-accumulator',
  'identity-lookup-execution', 'json-text-expression', 'lookup-let-variables', 'bounded-lookup-execution', 'union-with-records', 'result-binding-capacity'];
const schemas = ['UnsV2ResultBinding', 'UnsV2RecordTransactionReq', 'UnsV2FieldPredicate', 'UnsV2FieldComparisons', 'UnsV2PipelineAccumulator',
  'UnsV2PipelineStage', 'UnsV2PipelineExpression', 'UnsV2RecordChange'];
const updates = lock.schemaUpdates;
const start = updates.findIndex(item => item.scope === scope || previewScopes.includes(item.scope));
assert.ok(start >= 0, 'No reviewed App data query overlays found');
const tail = updates.slice(start);
if (tail[0].scope === scope) {
  assert.equal(tail.length, 1, 'Cannot replace a nonterminal overlay');
  assert.equal(tail[0].sourceKind, 'committed');
} else {
  assert.deepEqual(tail.map(item => item.scope), previewScopes, 'Expected the complete terminal preview chain');
  for (const item of tail) assert.equal(item.sourceKind, 'working-tree-preview', 'Expected a preview source');
}

const paths = {
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
  'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
};
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision, sourceKind: 'committed', inputs: {}, schemas };
for (const [path, sourcePath] of Object.entries(paths)) {
  const before = read(path), current = JSON.parse(before), raw = git('show', `${revision}:${sourcePath}`);
  const incoming = path.endsWith('/contract.json')
    ? JSON.parse(JSON.parse(raw.toString().match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m)?.[1] ?? 'null'))
    : JSON.parse(raw);
  assert.ok(incoming, `Missing committed contract ${sourcePath}`);
  const published = path.endsWith('openapi-v2.source.json');
  const omitted = published ? ['UnsV2RecordTransactionReq'] : [];
  const selected = schemas.filter(name => !omitted.includes(name));
  for (const name of selected) {
    const actual = (incoming.schemas ?? incoming.components.schemas)[name];
    assert.ok(actual, `Missing committed schema ${name}`);
    assert.deepEqual((current.schemas ?? current.components.schemas)[name], actual, `Committed schema differs: ${path} ${name}`);
  }
  if (published) {
    const request = doc => doc.paths['/uns/records:transact'].post.requestBody.content['application/json'].schema;
    assert.deepEqual(request(current), request(incoming), 'Committed public transaction request differs');
  }
  // 保留前一正式增量到最终合同的摘要链；被合并的中间预览不再伪装成独立正式来源。
  let expected = tail[0].inputs[path]?.baseSHA256;
  assert.match(expected ?? '', /^[a-f0-9]{64}$/);
  const baseSHA256 = expected;
  const previous = updates.slice(0, start).findLast(item => item.inputs?.[path]);
  if (previous) assert.equal(previous.inputs[path].resultSHA256, expected, `Broken committed prefix ${path}`);
  for (const item of tail) {
    assert.equal(item.inputs[path]?.baseSHA256, expected, `Broken preview chain ${item.scope}`);
    expected = item.inputs[path].resultSHA256;
  }
  assert.equal(expected, hash(before), `Broken final contract digest ${path}`);
  update.inputs[path] = { path: sourcePath, sourceSHA256: hash(raw), baseSHA256, resultSHA256: hash(before) };
}
lock.schemaUpdates = [...updates.slice(0, start), update];
provenance.schemaUpdates = lock.schemaUpdates;
provenance.sourceDerivedContractSHA256 = hash(read('contracts/uns-v2/contract.json'));
for (const [path, value] of [['contracts/upstream.json', lock], ['contracts/uns-v2/provenance.json', provenance]]) {
  writeFileSync(resolve(root, path), JSON.stringify(value, null, 2) + '\n');
}
console.log(`Verified App data query schemas against Backend ${revision}; replaced ${tail.length} source overlays without changing contract bytes.`);
