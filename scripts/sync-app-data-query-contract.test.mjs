import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test('committed App query sync verifies schemas, ignores dirty files, retains digest chain and is repeatable', () => {
  const root = fileURLToPath(new URL('../', import.meta.url)), scratch = mkdtempSync(resolve(tmpdir(), 'tier0-app-query-contract-'));
  try {
    const backend = resolve(scratch, 'backend'), sdk = resolve(scratch, 'sdk');
    mkdirSync(backend); mkdirSync(resolve(sdk, 'scripts'), { recursive: true });
    cpSync(resolve(root, 'contracts'), resolve(sdk, 'contracts'), { recursive: true });
    cpSync(resolve(root, 'scripts/sync-app-data-query-contract.mjs'), resolve(sdk, 'scripts/sync-app-data-query-contract.mjs'));
    const put = (path, value) => { const target = resolve(backend, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value); };
    const contract = readFileSync(resolve(root, 'contracts/uns-v2/contract.json'), 'utf8');
    put('service/unssvr/internal/domain/unsv2/contract_generated.go', `package unsv2\nconst ContractJSON = ${JSON.stringify(contract.trim())}\n`);
    const manifestPath = 'share/unscontract/manifest.json', specPath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
    put(manifestPath, readFileSync(resolve(root, 'contracts/uns-v2/manifest.json')));
    put(specPath, readFileSync(resolve(root, 'contracts/openapi-v2.source.json')));
    const git = (...args) => execFileSync('git', ['-C', backend, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    git('init', '-q'); git('add', '.');
    const commit = () => { git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qam', 'fixture'); return git('rev-parse', 'HEAD'); };
    const revision = commit();
    const run = ref => spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-app-data-query-contract.mjs'), backend, ref], { encoding: 'utf8' });
    const read = path => readFileSync(resolve(sdk, path));
    const before = read('contracts/upstream.json'), contractBefore = read('contracts/uns-v2/contract.json');
    assert.notEqual(run('--worktree').status, 0); assert.deepEqual(read('contracts/upstream.json'), before);
    const changed = JSON.parse(readFileSync(resolve(backend, manifestPath), 'utf8'));
    delete changed.schemas.UnsV2ResultBinding.properties.jsonPath;
    put(manifestPath, JSON.stringify(changed));
    const rejected = run(commit()); assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /Committed schema differs/);
    assert.deepEqual(read('contracts/upstream.json'), before);
    put(manifestPath, '{"uncommitted":"ignored"}');
    const result = run(revision); assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(read('contracts/upstream.json')), tail = metadata.schemaUpdates.find(item => item.scope === 'app-data-query-extensions');
    assert.equal(tail.scope, 'app-data-query-extensions'); assert.equal(tail.sourceKind, 'committed'); assert.equal(tail.revision, revision);
    assert.deepEqual(metadata.schemaUpdates.filter(item => item.scope !== 'app-data-query-extensions'),
      JSON.parse(before).schemaUpdates.filter(item => item.scope !== 'app-data-query-extensions'));
    assert.deepEqual(read('contracts/uns-v2/contract.json'), contractBefore);
    assert.deepEqual(metadata.schemaUpdates, JSON.parse(read('contracts/uns-v2/provenance.json')).schemaUpdates);
    const once = read('contracts/upstream.json'); assert.equal(run(revision).status, 0); assert.deepEqual(read('contracts/upstream.json'), once);
    const broken = JSON.parse(once); broken.schemaUpdates.find(item => item.scope === 'app-data-query-extensions').inputs['contracts/uns-v2/manifest.json'].baseSHA256 = '0'.repeat(64);
    writeFileSync(resolve(sdk, 'contracts/upstream.json'), JSON.stringify(broken));
    const provenance = JSON.parse(read('contracts/uns-v2/provenance.json')); provenance.schemaUpdates = broken.schemaUpdates;
    writeFileSync(resolve(sdk, 'contracts/uns-v2/provenance.json'), JSON.stringify(provenance));
    const badChain = run(revision); assert.notEqual(badChain.status, 0); assert.match(badChain.stderr, /Broken committed prefix/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
