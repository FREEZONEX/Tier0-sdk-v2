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
    const catalog = JSON.stringify({ list: [{ protocol: 'http-api', roles: ['client', 'server'] }, { protocol: 'http_push' }] });
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
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
