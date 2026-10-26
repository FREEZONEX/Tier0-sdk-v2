import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Pass the npm consumer directory, expected Workspace ID and a report path.
// Credentials are read only from this process environment; no raw responses are saved.
const [consumer, workspace, output] = process.argv.slice(2);
if (!consumer || !/^\d+$/.test(workspace ?? '') || !output) throw new Error('Usage: node scripts/check-live-readonly.mjs <consumer> <workspaceId> <report.json>');
const apiHost = process.env.TIER0_API_HOST;
const apiKey = process.env.TIER0_API_KEY;
if (!apiHost || !apiKey) throw new Error('TIER0_API_HOST and TIER0_API_KEY are required');
const installed = resolve(consumer, 'node_modules/@tier0/sdk-v2');
const pkg = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
const { createClient } = await import(pathToFileURL(resolve(installed, pkg.exports['.'].import.default)).href);
const client = createClient({ apiHost, apiKey, transportTimeoutMs: 15000 });
const report = { date: new Date().toISOString(), package: `${pkg.name}@${pkg.version}`, apiHost, workspace, mode: 'read-only', checks: [] };
const safeCode = value => typeof value === 'number' || typeof value === 'string' && /^[A-Z0-9_:-]{1,100}$/.test(value) ? value : undefined;
async function check(name, run) {
  try {
    const result = await run();
    const data = result?.data ?? result;
    const row = { name, status: 'passed' };
    if (Array.isArray(data?.list)) row.returnedItems = data.list.length;
    if (typeof data?.total === 'number') row.total = data.total;
    report.checks.push(row);
    console.log(JSON.stringify(row));
    return result;
  } catch (error) {
    const row = { name, status: 'failed', errorType: error.name, httpStatus: error.status, code: safeCode(error.errorCode ?? error.code), outcomeUnknown: error.outcomeUnknown === true };
    report.checks.push(row);
    console.log(JSON.stringify(row));
  }
}
try {
  const identity = await check('system.whoami', () => client.system.whoami());
  if (!identity || String(identity.workspaceID) !== workspace) throw new Error('Credential Workspace verification failed; no further calls made');
  report.identity = { workspaceId: String(identity.workspaceID), keyType: identity.keyType };
  console.log(JSON.stringify({ verifiedWorkspace: report.identity.workspaceId, keyType: identity.keyType }));
  const checks = [
    ['system.info', () => client.system.info()],
    ['members.listWorkspace', () => client.members.listWorkspace()],
    ['capabilities.discover', () => client.api.capabilities.discover()],
    ['controls.discover', () => client.controls.discover({})],
    ['source.protocols.list', () => client.source.protocols.list({})],
    ['source.documents.list', () => client.source.documents.list({ page: 1, size: 20 })],
    ['source.documents.list', () => client.source.documents.list({ page: 1, size: 20, includeDocument: false })],
    ['stream.programs.list', () => client.stream.programs.list({ page: 1, size: 20, archived: false })],
    ['stream.runtime.capabilities', () => client.stream.runtime.capabilities({})],
    ['uns.dataDiscover', () => client.uns.dataDiscover({ page: 1, size: 20 })],
    ['uns.metadataFind(directory)', () => client.uns.metadataFind({ kind: 'directory', page: { page: 1, size: 20 } })],
    ['uns.metadataFind(topic)', () => client.uns.metadataFind({ kind: 'topic', page: { page: 1, size: 20 } })],
    ['agent.jobs.list', () => client.agent.jobs.list({ page: 1, size: 20 })],
    ['agent.library.list', () => client.agent.library.list({ page: 1, size: 20 })],
    ['agent.results.list', () => client.agent.results.list({ page: 1, size: 20 })],
  ];
  for (const [name, run] of checks) await check(name, run);
  const canvases = await check('agent.canvases.list', () => client.agent.canvases.list({ page: 1, size: 20 }));
  if (canvases?.list?.[0]) await check('agent.cards.list', () => client.agent.cards.list({ canvasId: canvases.list[0].canvasId, page: 1, size: 20 }));
  else report.checks.push({ name: 'agent.cards.list', status: 'skipped', reason: 'No accessible canvas fixture' });
} finally {
  report.passed = report.checks.filter(check => check.status === 'passed').length;
  report.failed = report.checks.filter(check => check.status === 'failed').length;
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
}
if (report.failed) process.exitCode = 1;
