import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Preserve the reviewed provenance chain; synchronize only this read contract.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref, 'Usage: sync-read-limits.mjs <backend> <commit|--worktree>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const preview = ref === '--worktree', revision = git('rev-parse', `${preview ? 'HEAD' : ref}^{commit}`).toString().trim();
const upstream = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const read = path => readFileSync(resolve(root, path)), digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const lock = JSON.parse(read('contracts/upstream.json')), provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
assert.deepEqual(lock.schemaUpdates, provenance.schemaUpdates);
const scope = 'unbounded-read-counts';
const schemas = ['UnsV2DataFilter', 'UnsV2FieldPredicate', 'UnsV2FieldComparisons', 'UnsV2RecordGetReq',
  'CloudRecordBatchQuery', 'CloudRecordBatchQueryResult', 'UnsV2RecordQueryBatchReq', 'UnsV2RecordQueryBatchResponse', 'CloudAppDataLimits'];
const previous = lock.schemaUpdates?.find(item => item.scope === scope);
assert.ok(!previous || lock.schemaUpdates.at(-1) === previous, 'Cannot replace a nonterminal overlay');
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision, sourceKind: preview ? 'working-tree-preview' : 'committed', schemas, inputs: {} };
const sources = {
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
  'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
};
const outputs = new Map();
for (const [path, sourcePath] of Object.entries(sources)) {
  const before = read(path); assert.equal(digest(before), lock.inputs[path].sha256, `Unsynced input ${path}`);
  const raw = upstream(sourcePath), incoming = path.endsWith('/contract.json')
    ? JSON.parse(JSON.parse(raw.toString().match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m)[1])) : JSON.parse(raw);
  const current = JSON.parse(before), sourceSchemas = incoming.schemas ?? incoming.components.schemas;
  const targetSchemas = current.schemas ?? current.components.schemas;
  const published = path.endsWith('openapi-v2.source.json');
  const selected = published ? [...schemas.filter(name => !['UnsV2RecordGetReq', 'UnsV2RecordQueryBatchReq', 'UnsV2RecordQueryBatchResponse'].includes(name)), 'DocUnsV2RecordQueryBatchResponse'] : schemas;
  for (const name of selected) {
    assert.ok(sourceSchemas[name] && targetSchemas[name], `Missing schema ${name} in ${path}`);
    targetSchemas[name] = structuredClone(sourceSchemas[name]);
  }
  assert.equal(targetSchemas.UnsV2FieldComparisons.properties.$in.maxItems, undefined);
  assert.equal(targetSchemas.UnsV2FieldComparisons.properties.$in.minItems, 1);
  if (published) {
    for (const endpoint of ['/uns/collections/{collectionId}/records:get', '/uns/records:queryBatch']) {
      const source = incoming.paths[endpoint].post, target = current.paths[endpoint].post;
      target.requestBody.content['application/json'].schema = structuredClone(source.requestBody.content['application/json'].schema);
      target.description = source.description;
    }
  }
  const get = published ? current.paths['/uns/collections/{collectionId}/records:get'].post.requestBody.content['application/json'].schema : targetSchemas.UnsV2RecordGetReq;
  const batch = published ? current.paths['/uns/records:queryBatch'].post.requestBody.content['application/json'].schema : targetSchemas.UnsV2RecordQueryBatchReq;
  assert.equal(get.properties.ids.maxItems, undefined);
  assert.equal(batch.properties.queries.maxItems, undefined);
  assert.equal(targetSchemas[published ? 'DocUnsV2RecordQueryBatchResponse' : 'UnsV2RecordQueryBatchResponse'].properties.data.properties.results.maxProperties, undefined);
  assert.equal(targetSchemas.UnsV2DataFilter['x-tier0-query-limits'].maxInItems, 0);
  for (const key of ['maxQueries', 'maxRows', 'maxBytes']) assert.equal(targetSchemas.CloudAppDataLimits.properties.queryBatch.properties[key].minimum, 0);
  assert.equal(targetSchemas.CloudAppDataLimits.properties.get.properties.maxIds.minimum, 0);
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
