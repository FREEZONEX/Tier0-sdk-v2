import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
test('sync extracts Unicode contract strings and pins committed inputs instead of dirty files', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-contract-sync-'));
  try {
    const backend = resolve(scratch, 'backend');
    const sdk = resolve(scratch, 'sdk');
    cpSync(resolve(root, 'scripts'), resolve(sdk, 'scripts'), { recursive: true });
    mkdirSync(backend, { recursive: true });
    const put = (path, value) => {
      const file = resolve(backend, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, value);
    };
    const contract = { version: 'fixture', description: 'line\u2028paragraph\u2029quote"slash\\', schemas: {}, operations: [] };
    const contractFile = 'service/unssvr/internal/domain/unsv2/contract_generated.go';
    put(contractFile, 'package unsv2\nconst ContractJSON = ' + JSON.stringify(JSON.stringify(contract)) + '\n');
    put('service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json', '{}\n');
    put('share/unscontract/manifest.json', JSON.stringify({ version: 'fixture', cloudContractRevision: 'fixture/1' }));
    put('share/unscontract/cloud-support.json', '{}\n');
    put('share/unscontract/registry_generated.go', 'package unscontract\n');
    const catalogFile = 'share/unscontract/source-protocols.json';
    const catalog = JSON.stringify({ list: [{ protocol: 'http-api', roles: ['client', 'server'] }] });
    put(catalogFile, catalog);
    put('share/unscontract/provenance.json', JSON.stringify({ source: 'fixture' }));
    const git = (...args) => execFileSync('git', ['-C', backend, ...args], { encoding: 'utf8', stdio: 'pipe' });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'committed fixture');
    const revision = git('rev-parse', 'HEAD').trim();
    put(contractFile, 'dirty uncommitted contract');
    put(catalogFile, 'dirty uncommitted catalog');
    const result = spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-contracts.mjs'), backend, revision], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(resolve(sdk, 'contracts/uns-v2/contract.json'), 'utf8')), contract);
    assert.equal(readFileSync(resolve(sdk, 'contracts/uns-v2/source-protocols.json'), 'utf8'), catalog);
    const lock = JSON.parse(readFileSync(resolve(sdk, 'contracts/upstream.json'), 'utf8'));
    assert.equal(lock.revision, revision);
    assert.deepEqual(lock.inputs['contracts/uns-v2/source-protocols.json'], {
      path: catalogFile, sha256: createHash('sha256').update(catalog).digest('hex'),
    });
    const provenance = JSON.parse(readFileSync(resolve(sdk, 'contracts/uns-v2/provenance.json'), 'utf8'));
    assert.equal(provenance.revision, revision);
    assert.equal(provenance.cloudRevision, revision);
    // An explicit preview imports only platform changes and keeps the committed
    // data model intact, even when unrelated UNS files in the checkout are dirty.
    const platformPath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
    put(platformPath, '{"info":{"version":"preview"}}\n');
    const preview = spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-contracts.mjs'), backend, '--worktree', '--platform-only'], { encoding: 'utf8' });
    assert.equal(preview.status, 0, preview.stderr);
    const previewLock = JSON.parse(readFileSync(resolve(sdk, 'contracts/upstream.json'), 'utf8'));
    assert.equal(previewLock.platformSource.sourceKind, 'working-tree-preview');
    assert.equal(previewLock.platformSource.baseRevision, revision);
    assert.deepEqual(previewLock.inputs['contracts/uns-v2/contract.json'], lock.inputs['contracts/uns-v2/contract.json']);
    assert.deepEqual(JSON.parse(readFileSync(resolve(sdk, 'contracts/uns-v2/contract.json'), 'utf8')), contract);
    const publish = spawnSync(process.execPath, [resolve(sdk, 'scripts/check-contracts.mjs'), '--committed'], { encoding: 'utf8' });
    assert.notEqual(publish.status, 0);
    assert.match(publish.stderr, /working-tree preview/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('scoped sync imports components, inline requests and response aliases with atomic dependency checks and committed provenance', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-scoped-contract-sync-'));
  try {
    const backend = resolve(scratch, 'backend'), sdk = resolve(scratch, 'sdk');
    cpSync(resolve(root, 'scripts'), resolve(sdk, 'scripts'), { recursive: true });
    cpSync(resolve(root, 'contracts'), resolve(sdk, 'contracts'), { recursive: true });
    mkdirSync(backend);
    const sources = {
      'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
      'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
      'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
    };
    const read = path => readFileSync(resolve(sdk, path), 'utf8');
    const put = (path, value) => { const file = resolve(backend, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); };
    const schemaMap = document => document.schemas ?? document.components.schemas;
    const publicPath = 'contracts/openapi-v2.source.json';
    const aggregatePath = '/uns/collections/{collectionId}/samples:aggregate';
    const findPath = '/uns/collections/{collectionId}/samples:find';
    const aggregateRequest = document => document.schemas?.UnsV2SampleAggregateReq
      ?? document.paths[aggregatePath].post.requestBody.content['application/json'].schema;
    const explainResponse = document => document.schemas?.UnsV2RecordExplainResponse
      ?? schemaMap(document)[document.paths['/uns/collections/{collectionId}/records:explain'].post.responses['200']
        .content['application/json'].schema.$ref.split('/').at(-1)];
    const snapshots = new Map();
    for (const [path, remote] of Object.entries(sources)) {
      const incoming = JSON.parse(read(path)), schemas = schemaMap(incoming);
      schemas.UnsV2PipelineExpression.description += ' scoped fixture';
      schemas.CloudRecordLockView.description = 'unrelated schema change';
      aggregateRequest(incoming).properties.resultFormat = { type: 'string', enum: ['rows', 'series'], default: 'rows' };
      explainResponse(incoming).description = 'scoped response fixture';
      if (path === publicPath) incoming.paths[findPath].post.summary = 'unrelated operation change';
      snapshots.set(path, incoming);
      put(remote, path.endsWith('/contract.json') ? `package unsv2\nconst ContractJSON = ${JSON.stringify(JSON.stringify(incoming))}\n` : JSON.stringify(incoming));
    }
    const git = (...args) => execFileSync('git', ['-C', backend, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '-q'); git('add', '.');
    const commit = () => { git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'scoped fixture'); return git('rev-parse', 'HEAD'); };
    const revision = commit();
    const paths = [...Object.keys(sources), 'contracts/upstream.json', 'contracts/uns-v2/provenance.json'];
    const snapshot = () => Object.fromEntries(paths.map(path => [path, read(path)]));
    const before = snapshot();
    const check = (...flags) => spawnSync(process.execPath, [resolve(sdk, 'scripts/check-contracts.mjs'), ...flags], { encoding: 'utf8' });
    const publicationBefore = check('--committed');
    if (publicationBefore.status !== 0) assert.match(publicationBefore.stderr, /working-tree preview/);
    const run = (ref, ...flags) => spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-contracts.mjs'), backend, ref, ...flags], { encoding: 'utf8' });
    const flags = ['--schemas', 'UnsV2PipelineExpression,UnsV2SampleAggregateReq,UnsV2RecordExplainResponse', '--scope', 'scoped-fixture'];
    for (const invalid of [
      ['--schemas', 'UnsV2PipelineExpression'], ['--scope', 'scoped-fixture'],
      ['--schemas', 'UnsV2PipelineExpression,UnsV2PipelineExpression', '--scope', 'scoped-fixture'],
      ['--schemas', 'MissingSchema', '--scope', 'scoped-fixture'], [...flags, '--platform-only'],
      [...flags, '--schemas', 'UnsV2PipelineStage'], [...flags, '--unknown'],
    ]) {
      assert.notEqual(run(revision, ...invalid).status, 0);
      assert.deepEqual(snapshot(), before);
    }
    // Only the last input has a broken dependency: no earlier output may have been written.
    const broken = structuredClone(snapshots.get(publicPath));
    aggregateRequest(broken).properties.resultFormat = { $ref: '#/components/schemas/MissingDependency' };
    put(sources[publicPath], JSON.stringify(broken));
    const rejected = run(commit(), ...flags);
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /Missing dependency/);
    assert.deepEqual(snapshot(), before);
    // An existing but different dependency in the last input must also fail before any writes.
    const mismatch = structuredClone(snapshots.get(publicPath));
    schemaMap(mismatch).UnsV2FilterScalar.description = 'changed dependency';
    put(sources[publicPath], JSON.stringify(mismatch));
    const mismatched = run(commit(), ...flags);
    assert.notEqual(mismatched.status, 0); assert.match(mismatched.stderr, /Dependency differs: UnsV2FilterScalar.*include it in --schemas/);
    assert.deepEqual(snapshot(), before);
    const changedAlias = structuredClone(snapshots.get(publicPath));
    changedAlias.paths['/uns/collections/{collectionId}/records:explain'].post.responses['200']
      .content['application/json'].schema.$ref = '#/components/schemas/UnreviewedResponse';
    put(sources[publicPath], JSON.stringify(changedAlias));
    const aliasRejected = run(commit(), ...flags);
    assert.notEqual(aliasRejected.status, 0); assert.match(aliasRejected.stderr, /changed response schema reference/);
    assert.deepEqual(snapshot(), before);
    put(sources[publicPath], 'uncommitted dirty input must be ignored');
    const result = run(revision, ...flags);
    assert.equal(result.status, 0, result.stderr);
    for (const path of Object.keys(sources)) {
      const actual = JSON.parse(read(path)), original = JSON.parse(before[path]), incoming = snapshots.get(path);
      assert.deepEqual(schemaMap(actual).UnsV2PipelineExpression, schemaMap(incoming).UnsV2PipelineExpression);
      assert.deepEqual(schemaMap(actual).CloudRecordLockView, schemaMap(original).CloudRecordLockView);
      assert.deepEqual(aggregateRequest(actual), aggregateRequest(incoming));
      assert.deepEqual(explainResponse(actual), explainResponse(incoming));
      if (path === publicPath) {
        assert.equal(schemaMap(actual).UnsV2SampleAggregateReq, undefined);
        assert.equal(schemaMap(actual).UnsV2RecordExplainResponse, undefined);
        assert.deepEqual(actual.paths[findPath], original.paths[findPath]);
      }
    }
    const lock = JSON.parse(read('contracts/upstream.json')), previous = JSON.parse(before['contracts/upstream.json']);
    assert.equal(lock.revision, previous.revision);
    assert.deepEqual(lock.schemaUpdates.slice(0, -1), previous.schemaUpdates ?? []);
    assert.equal(lock.schemaUpdates.at(-1).sourceKind, 'committed');
    assert.equal(lock.schemaUpdates.at(-1).revision, revision);
    const publicUpdate = lock.schemaUpdates.at(-1).inputs[publicPath];
    assert.equal(publicUpdate.baseSHA256, previous.inputs[publicPath].sha256);
    assert.equal(publicUpdate.resultSHA256, lock.inputs[publicPath].sha256);
    const once = snapshot();
    assert.equal(run(revision, ...flags).status, 0);
    assert.deepEqual(snapshot(), once);
    const validated = check();
    assert.equal(validated.status, 0, validated.stderr);
    // 已有预览合同不能被一次已提交的局部同步变成可发布状态。
    const publish = check('--committed');
    assert.equal(publish.status, publicationBefore.status, publish.stderr);
    if (publicationBefore.status !== 0) assert.match(publish.stderr, /working-tree preview/);
    // A broken earlier digest cannot be concealed by replacing the terminal scope.
    for (const path of ['contracts/upstream.json', 'contracts/uns-v2/provenance.json']) {
      const value = JSON.parse(read(path));
      value.schemaUpdates.at(-1).inputs['contracts/uns-v2/manifest.json'].baseSHA256 = '0'.repeat(64);
      writeFileSync(resolve(sdk, path), JSON.stringify(value));
    }
    const invalidBefore = snapshot(), badChain = run(revision, ...flags);
    assert.notEqual(badChain.status, 0); assert.match(badChain.stderr, /Broken schema digest chain/);
    assert.deepEqual(snapshot(), invalidBefore);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
