import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertNoRetiredStreamProbe } from './retired-stream-probe.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('rejects every retired identity while allowing normal Stream and Control contracts', () => {
  for (const name of ['streamRuntimeCapabilitiesGet', 'CloudStreamRuntimeCapabilitiesGetReq',
    'CloudStreamRuntimeCapabilitiesGetResponse', '/uns/streams/runtime/capabilities/get']) {
    assert.throws(() => assertNoRetiredStreamProbe({ name }, 'fixture'), /Retired Stream probe/);
  }
  assert.doesNotThrow(() => assertNoRetiredStreamProbe({ operations: ['streamProgramDeploy', 'controlInvoke'] }, 'fixture'));
});

test('UNS generation rejects stale operation, schema, overlay and registry inputs before writing', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-probe-generator-'));
  try {
    cpSync(resolve(root, 'scripts'), resolve(scratch, 'scripts'), { recursive: true });
    cpSync(resolve(root, 'contracts'), resolve(scratch, 'contracts'), { recursive: true });
    mkdirSync(resolve(scratch, 'src/uns-v2'), { recursive: true });
    const output = resolve(scratch, 'src/uns-v2/generated.ts');
    writeFileSync(output, 'unchanged output');
    for (const [file, inject] of [
      ['manifest.json', json => { json.operations.push({ name: 'streamRuntimeCapabilitiesGet' }); }],
      ['contract.json', json => { json.schemas.CloudStreamRuntimeCapabilitiesGetReq = {}; }],
      ['cloud-support.json', json => { json.operations.push({ name: 'streamRuntimeCapabilitiesGet' }); }],
      ['registry_generated.go', null],
    ]) {
      const path = resolve(scratch, 'contracts/uns-v2', file);
      const original = readFileSync(path, 'utf8');
      if (inject) {
        const stale = JSON.parse(original);
        inject(stale);
        writeFileSync(path, JSON.stringify(stale));
      } else writeFileSync(path, original + '\n// streamRuntimeCapabilitiesGet\n');
      const result = spawnSync(process.execPath, [resolve(scratch, 'scripts/generate-uns-v2.mjs')], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, file);
      assert.match(result.stderr, /Retired Stream probe/, file);
      assert.equal(readFileSync(output, 'utf8'), 'unchanged output');
      writeFileSync(path, original);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('sync refuses an old upstream before changing any checked-in snapshot', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-probe-sync-'));
  try {
    const backend = resolve(scratch, 'backend');
    const sdk = resolve(scratch, 'sdk');
    mkdirSync(backend, { recursive: true });
    cpSync(resolve(root, 'scripts'), resolve(sdk, 'scripts'), { recursive: true });
    cpSync(resolve(root, 'contracts'), resolve(sdk, 'contracts'), { recursive: true });
    const upstreamPath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
    mkdirSync(resolve(backend, upstreamPath, '..'), { recursive: true });
    writeFileSync(resolve(backend, upstreamPath), JSON.stringify({ paths: { '/uns/streams/runtime/capabilities/get': {} } }));
    const git = (...args) => execFileSync('git', ['-C', backend, ...args], { stdio: 'pipe' });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'old upstream fixture');
    const before = readFileSync(resolve(sdk, 'contracts/upstream.json'), 'utf8');
    const spec = readFileSync(resolve(sdk, 'contracts/openapi-v2.source.json'), 'utf8');
    const result = spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-contracts.mjs'), backend, 'HEAD'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Retired Stream probe/);
    assert.equal(readFileSync(resolve(sdk, 'contracts/upstream.json'), 'utf8'), before);
    assert.equal(readFileSync(resolve(sdk, 'contracts/openapi-v2.source.json'), 'utf8'), spec);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
