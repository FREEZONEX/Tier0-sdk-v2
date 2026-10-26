import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, requestedRef] = process.argv.slice(2);
if (!backend || !requestedRef) throw new Error('Usage: npm run sync:contracts -- <backend checkout> <commit or ref>');
const git = (...args) => execFileSync('git', ['-C', resolve(backend), ...args], { maxBuffer: 50 * 1024 * 1024 });
const revision = git('rev-parse', '--verify', `${requestedRef}^{commit}`).toString('utf8').trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected a committed upstream revision');
const inputs = {
  'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
  'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go#ContractJSON',
  'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
  'contracts/uns-v2/cloud-support.json': 'share/unscontract/cloud-support.json',
  'contracts/uns-v2/registry_generated.go': 'share/unscontract/registry_generated.go',
};
const entries = {};
for (const [local, remote] of Object.entries(inputs)) {
  const [sourcePath, selector] = remote.split('#');
  let data = git('show', `${revision}:${sourcePath}`);
  if (selector === 'ContractJSON') {
    const match = data.toString('utf8').match(/^const ContractJSON = (".*")$/m);
    if (!match) throw new Error('Resolved Backend ContractJSON not found');
    data = Buffer.from(JSON.parse(match[1]) + '\n');
  }
  mkdirSync(dirname(resolve(root, local)), { recursive: true });
  writeFileSync(resolve(root, local), data);
  entries[local] = { path: remote, sha256: createHash('sha256').update(data).digest('hex') };
}
const manifest = JSON.parse(git('show', `${revision}:share/unscontract/manifest.json`));
const enterpriseBase = JSON.parse(git('show', `${revision}:share/unscontract/provenance.json`));
const provenance = { repository: 'FREEZONEX/Tier0-Backend', revision, version: manifest.version,
  source: inputs['contracts/uns-v2/contract.json'], cloudRevision: revision, cloudContractRevision: manifest.cloudContractRevision,
  resolvedCloudContract: true, enterpriseBase,
  sourceDerivedContractSHA256: entries['contracts/uns-v2/contract.json'].sha256 };
writeFileSync(resolve(root, 'contracts/uns-v2/provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
writeFileSync(resolve(root, 'contracts/upstream.json'), JSON.stringify({ repository: provenance.repository, revision, inputs: entries }, null, 2) + '\n');
console.log(`Pinned Backend ${revision}. Run npm run generate and review the contract diff.`);
