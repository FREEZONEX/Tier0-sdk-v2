import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertNoRetiredControls, retiredControlOperations, retiredControlSchemas } from './retired-controls.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

test('rejects every retired operation, DTO, route and compatibility label', () => {
  for (const name of [...retiredControlOperations, ...retiredControlSchemas, '/uns/controls/invoke', '/openapi/v1/controls/invoke', 'control/v1']) {
    assert.throws(() => assertNoRetiredControls({ name }, 'fixture'), /Retired Controls contract/);
    assert.throws(() => assertNoRetiredControls(JSON.stringify({ name }), 'fixture'), /Retired Controls contract/);
  }
});

test('does not reject Namespace, Stream management or neutral interaction contracts', () => {
  assert.doesNotThrow(() => assertNoRetiredControls({
    sdkContractVersions: ['stream-requests/v1'],
    operations: ['recordFind', 'streamDocumentUpdate', 'streamRequestGrantSet', 'appStreamPolicyGet'],
    schemas: ['CloudStreamRequestGrantSetReq', 'CloudStreamRunsListResponse'],
    policyVersion: 'cloud-hosted-app-control/v1',
    paths: ['/openapi/v1/stream-requests/invoke', '/openapi/v1/stream-messages/connect'],
  }, 'fixture'));
});

test('normal generator and contract check reject a stale DTO before changing generated output', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-controls-gate-'));
  try {
    cpSync(resolve(root, 'scripts'), resolve(scratch, 'scripts'), { recursive: true });
    cpSync(resolve(root, 'contracts'), resolve(scratch, 'contracts'), { recursive: true });
    mkdirSync(resolve(scratch, 'src/uns-v2'), { recursive: true });
    const output = resolve(scratch, 'src/uns-v2/generated.ts');
    writeFileSync(output, 'unchanged generated output');
    const path = resolve(scratch, 'contracts/uns-v2/manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.schemas.CloudControlInvokeReq = { type: 'object' };
    writeFileSync(path, JSON.stringify(manifest));
    for (const script of ['generate-uns-v2.mjs', 'check-contracts.mjs']) {
      const result = spawnSync(process.execPath, [resolve(scratch, 'scripts', script)], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, script);
      assert.match(result.stderr, /Retired Controls contract CloudControlInvokeReq/, script);
      assert.equal(readFileSync(output, 'utf8'), 'unchanged generated output');
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('normal sync refuses a stale operation atomically without changing snapshots or provenance', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-controls-sync-'));
  try {
    const backend = resolve(scratch, 'backend');
    const sdk = resolve(scratch, 'sdk');
    cpSync(resolve(root, 'scripts'), resolve(sdk, 'scripts'), { recursive: true });
    cpSync(resolve(root, 'contracts'), resolve(sdk, 'contracts'), { recursive: true });
    const lock = JSON.parse(readFileSync(resolve(root, 'contracts/upstream.json'), 'utf8'));
    const before = new Map();
    for (const [local, { path }] of Object.entries(lock.inputs)) {
      const original = readFileSync(resolve(sdk, local), 'utf8');
      before.set(local, original);
      const [remote, selector] = path.split('#');
      const target = resolve(backend, remote);
      mkdirSync(dirname(target), { recursive: true });
      let contents = selector === 'ContractJSON' ? 'package unsv2\nconst ContractJSON = ' + JSON.stringify(original.trim()) + '\n' : original;
      if (local.endsWith('/manifest.json')) {
        const manifest = JSON.parse(original);
        manifest.operations.push({ name: 'controlInvoke' });
        contents = JSON.stringify(manifest);
      }
      writeFileSync(target, contents);
    }
    for (const name of ['contracts/upstream.json', 'contracts/uns-v2/provenance.json']) before.set(name, readFileSync(resolve(sdk, name), 'utf8'));
    writeFileSync(resolve(backend, 'share/unscontract/provenance.json'), '{}');
    const git = (...args) => execFileSync('git', ['-C', backend, ...args], { stdio: 'pipe' });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'stale controls fixture');
    const result = spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-contracts.mjs'), backend, 'HEAD'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Retired Controls contract controlInvoke/);
    for (const [name, original] of before) assert.equal(readFileSync(resolve(sdk, name), 'utf8'), original, name);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
