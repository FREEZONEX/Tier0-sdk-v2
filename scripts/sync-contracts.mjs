import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoRetiredStreamProbe } from './retired-stream-probe.mjs';
import { assertNoRetiredHTTPPush } from './retired-http-push.mjs';
import { assertNoRetiredControls } from './retired-controls.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, requestedRef] = process.argv.slice(2);
if (!backend || !requestedRef) throw new Error('Usage: npm run sync:contracts -- <backend checkout> <commit or ref>');
const git = (...args) => execFileSync('git', ['-C', resolve(backend), ...args], { maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const preview = requestedRef === '--worktree';
function baseRevision() {
  try { return git('rev-parse', '--verify', 'HEAD^{commit}').toString('utf8').trim(); }
  catch { return JSON.parse(readFileSync(resolve(backend, '.git/source-baseline.json'), 'utf8')).sha; }
}
const revision = preview ? baseRevision() : git('rev-parse', '--verify', `${requestedRef}^{commit}`).toString('utf8').trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected a committed upstream revision');
const readSource = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const sourceMetadata = preview ? { sourceKind: 'working-tree-preview', baseRevision: revision } : {};
// Platform routing/capability changes can be reviewed independently of the UNS
// data model, whose committed inputs remain pinned until explicitly migrated.
if (process.argv.includes('--platform-only')) {
  const local = 'contracts/openapi-v2.source.json';
  const sourcePath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
  const data = readSource(sourcePath);
  assertNoRetiredStreamProbe(data.toString('utf8'), sourcePath);
  assertNoRetiredHTTPPush(data.toString('utf8'), sourcePath);
  assertNoRetiredControls(data.toString('utf8'), sourcePath);
  const lockPath = resolve(root, 'contracts/upstream.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.inputs[local] = { path: sourcePath, sha256: createHash('sha256').update(data).digest('hex') };
  lock.platformSource = { repository: 'FREEZONEX/Tier0-Backend', revision, ...sourceMetadata };
  writeFileSync(resolve(root, local), data);
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`Synced platform contract ${preview ? 'preview based on' : 'at'} ${revision}; UNS inputs remain pinned.`);
  process.exit(0);
}
const inputs = {
  'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go#ContractJSON',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
  'contracts/uns-v2/cloud-support.json': 'share/unscontract/cloud-support.json',
  'contracts/uns-v2/registry_generated.go': 'share/unscontract/registry_generated.go',
  'contracts/uns-v2/source-protocols.json': 'share/unscontract/source-protocols.json',
};
const entries = {};
const contents = {};
for (const [local, remote] of Object.entries(inputs)) {
  const [sourcePath, selector] = remote.split('#');
  let data = readSource(sourcePath);
  if (selector === 'ContractJSON') {
    const match = data.toString('utf8').match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m);
    if (!match) throw new Error('Resolved Backend ContractJSON not found');
    data = Buffer.from(JSON.parse(match[1]) + '\n');
  }
  assertNoRetiredStreamProbe(data.toString('utf8'), remote);
  assertNoRetiredHTTPPush(data.toString('utf8'), remote);
  assertNoRetiredControls(data.toString('utf8'), remote);
  contents[local] = data;
  entries[local] = { path: remote, sha256: createHash('sha256').update(data).digest('hex') };
}
const manifest = JSON.parse(readSource('share/unscontract/manifest.json'));
const enterpriseBase = JSON.parse(readSource('share/unscontract/provenance.json'));
const provenance = { repository: 'FREEZONEX/Tier0-Backend', revision, ...sourceMetadata, version: manifest.version,
  source: inputs['contracts/uns-v2/contract.json'], cloudRevision: revision, cloudContractRevision: manifest.cloudContractRevision,
  resolvedCloudContract: true, enterpriseBase,
  sourceDerivedContractSHA256: entries['contracts/uns-v2/contract.json'].sha256 };
// Validate every input before writing any snapshot or its provenance.
for (const [local, data] of Object.entries(contents)) {
  mkdirSync(dirname(resolve(root, local)), { recursive: true });
  writeFileSync(resolve(root, local), data);
}
writeFileSync(resolve(root, 'contracts/uns-v2/provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
writeFileSync(resolve(root, 'contracts/upstream.json'), JSON.stringify({ repository: provenance.repository, revision, ...sourceMetadata, inputs: entries }, null, 2) + '\n');
console.log(`${preview ? 'Previewed working tree based on' : 'Pinned'} Backend ${revision}. Run npm run generate and review the contract diff.`);
