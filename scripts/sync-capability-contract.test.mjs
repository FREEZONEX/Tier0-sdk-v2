import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

test('capability sync pins original committed bytes, isolates dirty sources and rejects preview publication', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = mkdtempSync(resolve(tmpdir(), 'tier0-capability-contract-'));
  try {
    const backend = resolve(scratch, 'backend');
    const sdk = resolve(scratch, 'sdk');
    mkdirSync(resolve(backend, 'share/domain/capability/testdata'), { recursive: true });
    mkdirSync(resolve(sdk, 'scripts'), { recursive: true });
    mkdirSync(resolve(sdk, 'src'), { recursive: true });
    mkdirSync(resolve(sdk, 'contracts/capability-discovery'), { recursive: true });
    cpSync(resolve(root, 'scripts/sync-capability-contract.mjs'), resolve(sdk, 'scripts/sync-capability-contract.mjs'));
    writeFileSync(resolve(sdk, 'src/capabilities.ts'), 'fixture consumer\n');
    writeFileSync(resolve(sdk, 'package.json'), '{"name":"@tier0/sdk-v2"}');
    const schemaPath = 'share/domain/capability/discovery.schema.json';
    const bytes = readFileSync(resolve(root, 'contracts/capability-discovery/response.schema.json'));
    writeFileSync(resolve(backend, schemaPath), bytes);
    cpSync(resolve(root, 'contracts/capability-discovery/vectors.json'), resolve(backend, 'share/domain/capability/testdata/discovery.vectors.json'));
    const git = (...args) => execFileSync('git', ['-C', backend, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
    const revision = git('rev-parse', 'HEAD').toString().trim();
    const run = (...args) => spawnSync(process.execPath, [resolve(sdk, 'scripts/sync-capability-contract.mjs'), ...args], { encoding: 'utf8' });
    const metadata = () => JSON.parse(readFileSync(resolve(sdk, 'contracts/capability-discovery/provenance.json')));
    writeFileSync(resolve(backend, schemaPath), '{"$id":"uncommitted-invalid"}');
    const committed = run(backend, revision);
    assert.equal(committed.status, 0, committed.stderr);
    assert.equal(metadata().inputs['contracts/capability-discovery/response.schema.json'], createHash('sha256').update(git('show', `${revision}:${schemaPath}`)).digest('hex'));
    assert.equal(run('--check', '--committed').status, 0);
    writeFileSync(resolve(backend, schemaPath), bytes);
    assert.equal(run(backend, '--worktree').status, 0);
    assert.equal(metadata().sourceKind, 'working-tree-preview');
    assert.equal(metadata().baseRevision, revision);
    assert.equal(run('--check').status, 0);
    const preview = run('--check', '--committed');
    assert.notEqual(preview.status, 0);
    assert.match(preview.stderr, /working-tree preview/);
    writeFileSync(resolve(sdk, 'src/capabilities.ts'), 'unexpected consumer change');
    assert.notEqual(run('--check').status, 0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
