import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [consumer, workspace, output, optIn] = process.argv.slice(2);
if (!consumer || !/^\d+$/.test(workspace ?? '') || !output || optIn !== '--write-test-fixtures') {
  throw new Error('Expected consumer, Workspace, report and --write-test-fixtures');
}
assert.ok(process.env.TIER0_API_HOST && process.env.TIER0_API_KEY, 'Explicit API host and key required');
const installed = resolve(consumer, 'node_modules/@tier0/sdk-v2');
const pkg = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
const { createClient } = await import(pathToFileURL(resolve(installed, pkg.exports['.'].import.default)).href);
const client = createClient({ transportTimeoutMs: 20000 });
assert.equal(String((await client.system.whoami()).workspaceID), workspace);
const name = `sdkv2-runtime-${randomUUID()}`;
const report = { date: new Date().toISOString(), workspace, name, steps: [] };
let id;
let revision;
const save = () => writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
async function step(name, fn) {
  try {
    await fn();
    report.steps.push({ name, passed: true });
  } catch (error) {
    report.steps.push({ name, passed: false, status: error.status, code: error.code,
      errorType: error.name, requestId: error.requestId, outcomeUnknown: error.outcomeUnknown === true });
    process.exitCode = 1;
    throw error;
  } finally {
    save();
    console.log(JSON.stringify(report.steps.at(-1)));
  }
}
const document = { name, sdkVersion: 'tier0-stream/v2', timeoutMs: 5000,
  script: 'module.exports = api => { api.stream.onTimer({ id: "sdk_tick", intervalMs: 1000 }, async () => ({ sdkAcceptance: true, value: 1 })); };' };
try {
  await step('create', async () => {
    const created = await client.stream.documents.create({ dryRun: false, program: document, idempotencyKey: `${name}-create` });
    id = created.data.id;
    assert.equal(typeof id, 'string');
    revision = created.data.revision;
    assert.ok(revision !== undefined && BigInt(String(revision)) > 0n);
    report.id = id;
  });
  await step('deploy', async () => {
    const deployed = await client.stream.programs.deploy({ id, dryRun: false, expectedRevision: revision, idempotencyKey: `${name}-deploy` });
    report.activeVersion = deployed.data.activeVersion;
    assert.ok(report.activeVersion && report.activeVersion !== '0');
    assert.ok(deployed.data.activeRelease !== undefined && BigInt(String(deployed.data.activeRelease)) > 0n,
      'Deployment receipt must identify its own release; never substitute the current head');
    report.activeRelease = String(deployed.data.activeRelease);
  });
  await step('runtime execution', async () => {
    const deadline = Date.now() + 30000;
    do {
      const runs = (await client.stream.runs.list({ id, size: 10 })).data;
      // Runs uses items, not list. Only this release can prove this deployment ran.
      report.runs = runs.items.map(({ id, release, status, createdAt, finishedAt }) => ({ id, release, status, createdAt, finishedAt }));
      save();
      if (report.runs.some(run => run.status === 'completed' && String(run.release) === String(report.activeRelease))) return;
      await new Promise(resolve => setTimeout(resolve, 1500));
    } while (Date.now() < deadline);
    throw new Error('No completed run observed before polling deadline');
  });
} catch {
  // Preserve the failed step and still clean up the isolated test stream.
} finally {
  if (id) {
    try {
      await step('disable and archive', async () => {
        let current = (await client.stream.documents.get({ id })).data;
        if (String(current.activeRelease) !== '0') {
          await client.stream.documents.disable({ id, expectedRevision: current.revision,
            expectedActiveRelease: current.activeRelease, dryRun: false, idempotencyKey: `${name}-disable` });
          current = (await client.stream.documents.get({ id })).data;
          assert.equal(String(current.activeRelease), '0');
        }
        const removed = await client.stream.programs.delete({ id, expectedRevision: current.revision,
          dryRun: false, idempotencyKey: `${name}-delete` });
        assert.equal(removed.data.deleted, true);
        report.cleanup = 'archived';
      });
    } catch {
      report.cleanup = 'failed; inspect the reported id before retrying';
    }
  } else if (report.steps.some(step => step.outcomeUnknown)) {
    report.cleanup = 'creation outcome unknown; reconcile by unique name and idempotency key';
  }
  save();
}
