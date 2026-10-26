import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { checkExtendedUns } from './live-uns-extended.mjs';

// Explicitly opt in to creating, modifying and cleaning up this run's test fixtures.
// Never point this script at an environment without authorization for these writes.
const [consumer, workspace, output, optIn] = process.argv.slice(2);
if (!consumer || !/^\d+$/.test(workspace ?? '') || !output || optIn !== '--write-test-fixtures') {
  throw new Error('Usage: node scripts/check-live-workflows.mjs <consumer> <workspaceId> <report.json> --write-test-fixtures');
}
const apiHost = process.env.TIER0_API_HOST;
const apiKey = process.env.TIER0_API_KEY;
if (!apiHost || !apiKey) throw new Error('TIER0_API_HOST and TIER0_API_KEY required');
const installed = resolve(consumer, 'node_modules/@tier0/sdk-v2');
const pkg = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
const sdk = await import(pathToFileURL(resolve(installed, pkg.exports['.'].import.default)).href);
const client = sdk.createClient({ apiHost, apiKey, transportTimeoutMs: 20000 });
const identity = await client.system.whoami();
assert.equal(String(identity.workspaceID), workspace, 'Wrong Workspace; no mutations performed');
const prefix = `sdkv2-${new Date().toISOString().slice(0,10).replaceAll('-', '')}-${randomUUID().slice(0,8)}`;
const report = { date: new Date().toISOString(), package: `${pkg.name}@${pkg.version}`, apiHost, workspace, prefix, checks: [], fixtures: {} };
const intent = name => `${prefix}-${name}`;
const domains = new Set((process.env.TIER0_TEST_DOMAINS ?? 'source,stream,uns,files').split(','));
for (const domain of domains) if (!['source', 'stream', 'uns', 'files', 'extended'].includes(domain)) throw new Error('Invalid TIER0_TEST_DOMAINS');
if (domains.has('extended') && !domains.has('uns')) throw new Error('extended requires uns');
const save = () => writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
async function step(name, fn) {
  try {
    const result = await fn();
    report.checks.push({ name, status: 'passed' });
    console.log(JSON.stringify({ name, status: 'passed' }));
    save();
    return result;
  } catch (error) {
    const row = { name, status: 'failed', errorType: error.name, httpStatus: error.status, code: error.errorCode ?? error.code, requestId: error.requestId, outcomeUnknown: error.outcomeUnknown === true,
      message: String(error.message).replaceAll(apiKey, '[REDACTED]').slice(0,400) };
    report.checks.push(row);
    console.log(JSON.stringify(row));
    save();
    throw error;
  }
}
function example(domain, file, index = 0) {
  const markdown = readFileSync(resolve(installed, `skills/tier0-sdk-v2/tier0-sdk-v2-${domain}/references/${file}.md`), 'utf8');
  const code = [...markdown.matchAll(/```ts\r?\n([\s\S]*?)```/g)][index]?.[1];
  if (!code) throw new Error('Missing packed Skill example');
  const module = { exports: {} };
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name !== '@tier0/sdk-v2') throw new Error('Unexpected Skill dependency');
    return sdk;
  } });
  return module.exports;
}
const sourceCreate = example('source', 'create');
const sourceUpdate = example('source', 'update');
const sourceDelete = example('source', 'delete');
const streamCreate = example('stream', 'create');
const streamUpdate = example('stream', 'update');
const streamDelete = example('stream', 'delete');
const unsCreate = example('uns', 'create');
const recordCreate = example('uns', 'create', 1);
const recordUpdate = example('uns', 'update', 2);
const collectionUpdate = example('uns', 'update');
const recordDelete = example('uns', 'delete');
const collectionDelete = example('uns', 'delete', 1);
const restore = example('uns', 'restore');
let sourceId, sourceRevision, streamId, collectionId, filePath;
save();

try {
  if (domains.has('source')) try {
    await step('Skill Source create with canonical receipt', async () => {
      const result = await sourceCreate.createHttpSource(`${apiHost}/__sdk_acceptance/inert`, prefix, intent('source-create'), client);
      sourceId = result.current.id;
      sourceRevision = result.current.revision;
      report.fixtures.source = { id: sourceId, state: 'created' };
      assert.equal(result.current.document.name, prefix);
      assert.notEqual(result.current.desiredState, 'enabled');
    });
    await step('Skill Source direct patch with canonical receipt', async () => {
      const result = await sourceUpdate.renameSource(sourceId, sourceRevision, prefix + '-edited', intent('source-update'), client);
      sourceRevision = result.current.revision;
      assert.equal(result.current.document.name, prefix + '-edited');
    });
    await step('Skill Source observations', () => example('source', 'read').readSource(sourceId, client));
    if (domains.has('stream')) {
    await step('Skill Stream validate + create + read', async () => {
      const result = await streamCreate.createHttpStream(sourceId, prefix, intent('stream-create'), client);
      streamId = result.current.id;
      report.fixtures.stream = { id: streamId, state: 'draft' };
      assert.equal(result.current.document.name, prefix);
    });
    await step('Skill Stream update + read', async () => {
      const result = await streamUpdate.updateStreamDescription(streamId, 'SDK acceptance draft', intent('stream-update'), client);
      assert.equal(result.current.document.description, 'SDK acceptance draft');
    });
    await step('Skill Stream draft + summary + observations', () => example('stream', 'read').readStream(streamId, client));
    }
  } catch { /* Preserve failures and continue independent domains; cleanup below. */ }
  finally {
    if (streamId) {
      try { await step('Skill Stream delete + archived readback', async () => {
        const result = await streamDelete.deleteStream(streamId, intent('stream-delete'), client);
        assert.equal(result.archived?.id, streamId);
        report.fixtures.stream.state = 'archived';
      }); } catch { /* Report retains cleanup failure. */ }
    }
    if (sourceId) {
      try { await step('Skill Source direct delete with archived receipt', async () => {
        // Retain the observed revision. Unexpected changes or remaining Stream references must reject cleanup.
        const result = await sourceDelete.deleteSource(sourceId, sourceRevision, intent('source-delete'), client);
        assert.equal(result.state, 'archived');
        report.fixtures.source.state = 'archived';
      }); } catch { /* Report retains cleanup failure. */ }
    }
  }

  if (domains.has('stream') && !streamId) try {
    await step('Stream standalone draft create + read', async () => {
      const document = { name: prefix, sdkVersion: 'tier0-stream/v2', timeoutMs: 5000,
        script: 'module.exports = api => { api.stream.onTimer({ id: "tick", intervalMs: 60000 }, async () => ({ value: 1 })); };' };
      const validation = await client.stream.documents.validate({ program: document });
      assert.equal(validation.data.valid, true);
      const saved = await client.stream.documents.create({ dryRun: false, program: document, idempotencyKey: intent('standalone-stream') });
      assert.equal(typeof saved.data.id, 'string');
      streamId = saved.data.id;
      report.fixtures.stream = { id: streamId, state: 'draft' };
      assert.equal((await client.stream.documents.get({ id: streamId })).data.document.name, prefix);
    });
    await step('Skill Stream standalone update + read', () => streamUpdate.updateStreamDescription(streamId, 'SDK acceptance draft', intent('standalone-update'), client));
  } catch { /* No deployment; record the backend failure. */ }
  finally {
    if (streamId && report.fixtures.stream.state !== 'archived') try {
      await step('Skill Stream standalone cleanup', async () => {
        const result = await streamDelete.deleteStream(streamId, intent('standalone-delete'), client);
        assert.equal(result.archived?.id, streamId);
        report.fixtures.stream.state = 'archived';
      });
    } catch { /* Report retains cleanup failure. */ }
  }

  if (domains.has('uns')) try {
    const id = prefix + '-collection';
    await step('Skill UNS collection create + read', async () => {
      const result = await unsCreate.createDeviceCollection(id, prefix, intent('collection-create'), client);
      assert.equal(result.state, 'committed');
      collectionId = id;
      report.fixtures.collection = { id, state: 'created' };
      assert.equal(result.current.data.name, prefix);
    });
    await step('Skill UNS collection update + read', async () => {
      const result = await collectionUpdate.renameCollection(collectionId, prefix + '-edited', intent('collection-update'), client);
      assert.equal(result.data.status, 'committed');
      assert.equal(result.data.value.data.name, prefix + '-edited');
    });
    await step('Skill UNS record create + snapshot', async () => {
      const result = await recordCreate.insertDevice(collectionId, 'device-1', 'SDK device', intent('record-create'), client);
      assert.equal(result.state, 'committed');
      assert.equal(result.created.data.name, 'SDK device');
    });
    await step('Skill UNS record update + read', async () => {
      const result = await recordUpdate.renameDevice(collectionId, 'device-1', 'SDK edited', intent('record-update'), client);
      assert.equal(result.state, 'committed');
    });
    if (domains.has('extended')) await checkExtendedUns(client, collectionId, prefix, step, report);
    await step('Skill UNS record delete + readback', async () => {
      assert.equal((await recordDelete.deleteDevice(collectionId, 'device-1', intent('record-delete'), client)).state, 'committed');
    });
    await step('Skill UNS record restore + readback', async () => {
      assert.equal((await restore.restoreDevice(collectionId, 'device-1', intent('record-restore'), client)).state, 'committed');
    });
    await step('Skill UNS restored record delete', async () => {
      assert.equal((await recordDelete.deleteDevice(collectionId, 'device-1', intent('record-delete-final'), client)).state, 'committed');
    });
    await step('Skill UNS collection archive + readback', async () => {
      const result = await collectionDelete.deleteCollection(collectionId, intent('collection-archive'), client);
      assert.equal(result.state, 'deleted');
      report.fixtures.collection.state = 'archived';
      report.fixtures.collection.revision = String(result.deleted.revision);
    });
    await step('Skill UNS collection restore + readback', async () => {
      const result = await restore.restoreCollection(collectionId, intent('collection-restore'), client);
      assert.equal(result.state, 'committed');
      report.fixtures.collection.state = 'restored';
    });
  } catch { /* Continue; cleanup only this run's collection. */ }
  finally {
    if (collectionId && report.fixtures.collection.state !== 'archived') {
      try { await step('Skill UNS collection cleanup + archived readback', async () => {
        const result = await collectionDelete.deleteCollection(collectionId, intent('collection-cleanup'), client);
        assert.equal(result.state, 'deleted');
        report.fixtures.collection.state = 'archived';
      }); } catch { /* Report retains cleanup failure. */ }
    }
  }

  if (domains.has('files')) try {
    const contents = `Tier0 SDK acceptance ${prefix}\n`;
    await step('Files upload', async () => {
      const result = await client.files.upload(new File([contents], `${prefix}.txt`, { type: 'text/plain' }));
      assert.ok(result.filePath);
      filePath = result.filePath;
      report.fixtures.file = { state: 'uploaded' };
    });
    await step('Files URL + download content', async () => {
      assert.ok((await client.files.url({ filePath })).fileUrl);
      assert.equal(await (await client.files.download({ filePath })).text(), contents);
    });
  } catch { /* Report failure. */ }
  finally {
    if (filePath) {
      try { await step('Files delete test object', async () => {
        assert.equal((await client.files.delete({ filePath })).deleted, true);
        report.fixtures.file.state = 'deleted';
      }); } catch { /* Report retains cleanup failure. */ }
    }
  }
} finally {
  report.passed = report.checks.filter(check => check.status === 'passed').length;
  report.failed = report.checks.filter(check => check.status === 'failed').length;
  save();
}
if (report.failed) process.exitCode = 1;
