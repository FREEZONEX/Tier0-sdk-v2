import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertNoRetiredHTTPPush } from './retired-http-push.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('rejects retired protocol and ingress path while preserving HTTP Client/Server and Stream replies', () => {
  for (const name of ['http_push', '/ingest/v1/messages']) {
    assert.throws(() => assertNoRetiredHTTPPush({ name }, 'fixture'), /Retired HTTP Push/);
  }
  assert.doesNotThrow(() => assertNoRetiredHTTPPush({ protocol: 'http-api', roles: ['client', 'server'],
    prefix: '/ingest/v1/{workspaceId}/{sourceId}', script: 'await ctx.reply({status:202})' }, 'fixture'));
});

test('sync rejects a stale catalog atomically, preserving all snapshots and provenance', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-http-push-sync-'));
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
      if (local.endsWith('source-protocols.json')) {
        const catalog = JSON.parse(original);
        catalog.list.push({ protocol: 'http_push' });
        contents = JSON.stringify(catalog);
      }
      writeFileSync(target, contents);
    }
    for (const name of ['contracts/upstream.json', 'contracts/uns-v2/provenance.json']) {
      before.set(name, readFileSync(resolve(sdk, name), 'utf8'));
    }
    writeFileSync(resolve(backend, 'share/unscontract/provenance.json'), '{}');
    const git = (...args) => execFileSync('git', ['-C', backend, ...args], { stdio: 'pipe' });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'stale catalog fixture');
    const result = spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-contracts.mjs'), backend, 'HEAD'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Retired HTTP Push/);
    assert.match(result.stderr, /source-protocols\.json/);
    for (const [name, original] of before) assert.equal(readFileSync(resolve(sdk, name), 'utf8'), original, name);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('UNS generation rejects a stale protocol before replacing generated types', () => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-http-push-generate-'));
  try {
    cpSync(resolve(root, 'scripts'), resolve(scratch, 'scripts'), { recursive: true });
    cpSync(resolve(root, 'contracts'), resolve(scratch, 'contracts'), { recursive: true });
    mkdirSync(resolve(scratch, 'src/uns-v2'), { recursive: true });
    const output = resolve(scratch, 'src/uns-v2/generated.ts');
    writeFileSync(output, 'unchanged output');
    const path = resolve(scratch, 'contracts/uns-v2/contract.json');
    const contract = JSON.parse(readFileSync(path, 'utf8'));
    contract.schemas.CloudSourceDocument.properties.protocol.enum.push('http_push');
    writeFileSync(path, JSON.stringify(contract));
    const result = spawnSync(process.execPath, [resolve(scratch, 'scripts/generate-uns-v2.mjs')], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Retired HTTP Push/);
    assert.equal(readFileSync(output, 'utf8'), 'unchanged output');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
