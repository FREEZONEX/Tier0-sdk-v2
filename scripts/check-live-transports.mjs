import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [consumer, workspace, output, optIn] = process.argv.slice(2);
if (!consumer || !/^\d+$/.test(workspace ?? '') || !output || optIn !== '--write-test-fixtures') throw new Error('Expected consumer, Workspace, report and --write-test-fixtures');
const installed = resolve(consumer, 'node_modules/@tier0/sdk-v2');
const pkg = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
const sdk = await import(pathToFileURL(resolve(installed, pkg.exports['.'].import.default)).href);
const { Tier0MQClient, toWebSocketUrl } = await import(pathToFileURL(resolve(installed, pkg.exports['./mq'].import.default)).href);
const apiKey = process.env.TIER0_API_KEY;
const apiHost = process.env.TIER0_API_HOST;
assert.ok(apiKey && apiHost, 'TIER0_API_HOST and TIER0_API_KEY are required');
const exchanges = [];
const client = sdk.createClient({ apiHost, apiKey, transportTimeoutMs: 60000, fetch: async (url, init) => {
  const start = Date.now();
  const endpoint = new URL(url);
  try {
    const response = await fetch(url, init);
    exchanges.push({ origin: endpoint.origin, method: init?.method ?? 'GET', status: response.status, durationMs: Date.now() - start });
    return response;
  } catch (error) {
    exchanges.push({ origin: endpoint.origin, method: init?.method ?? 'GET', errorType: error.name, durationMs: Date.now() - start });
    throw error;
  }
} });
assert.equal(String((await client.system.whoami()).workspaceID), workspace);
const report = { date: new Date().toISOString(), package: `${pkg.name}@${pkg.version}`, workspace, checks: [], exchanges };
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, status: 'passed' }); }
  catch (error) { report.checks.push({ name, status: 'failed', errorType: error.name, httpStatus: error.status,
    cause: error.cause ? { name: error.cause.name, status: error.cause.status, message: String(error.cause.message).replaceAll(apiKey, '[REDACTED]').slice(0,200) } : undefined,
    message: String(error.message).replaceAll(apiKey, '[REDACTED]').slice(0,200) }); }
  console.log(JSON.stringify(report.checks.at(-1)));
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
}
let filePath, pendingSession;
const bytes = new Uint8Array(6 * 1024 * 1024).fill(42);
await check('Files multipart upload + progress + content hash', async () => {
  const progress = [];
  try {
    const saved = await client.files.uploadMultipart(new File([bytes], `sdkv2-multipart-${randomUUID()}.bin`, { type: 'application/octet-stream' }), {
      partSize: 5 * 1024 * 1024, onProgress: p => progress.push(p.uploadedBytes),
    });
    filePath = saved.filePath;
    assert.ok(filePath);
    assert.equal(progress.at(-1), bytes.length);
    assert.equal(progress.length, 2);
    const downloaded = new Uint8Array(await (await client.files.download({ filePath })).arrayBuffer());
    assert.equal(createHash('sha256').update(downloaded).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  } catch (error) {
    if (error instanceof sdk.MultipartUploadError) pendingSession = error.session;
    throw error;
  }
});
if (filePath) await check('Files multipart object cleanup', async () => { assert.equal((await client.files.delete({ filePath })).deleted, true); });
if (pendingSession && !pendingSession.completionAttempted) await check('Files incomplete multipart cleanup', () => client.files.multipart.abort({ fileKey: pendingSession.fileKey, uploadId: pendingSession.uploadId }));
if (pendingSession?.completionAttempted) report.cleanup = 'Completion outcome unknown; reconcile before abort or retry';

let mq;
await check('MQTT service-key connection', async () => {
  const info = await client.system.info();
  assert.ok(info.mqttBroker, 'Environment did not advertise an MQTT broker');
  const endpoint = toWebSocketUrl(info.mqttBroker);
  report.mqttEndpoint = endpoint;
  mq = new Tier0MQClient({ host: endpoint, password: apiKey, reconnectPeriod: 0, connectTimeout: 10000 });
  mq.on('error', () => {});
  let timer;
  try {
    await Promise.race([mq.connect(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('MQTT connection deadline exceeded')), 12000); })]);
    assert.equal(mq.isConnected, true);
  } finally { clearTimeout(timer); mq.disconnect(); }
});
report.passed = report.checks.filter(x => x.status === 'passed').length;
report.failed = report.checks.filter(x => x.status === 'failed').length;
writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
if (report.failed) process.exitCode = 1;
