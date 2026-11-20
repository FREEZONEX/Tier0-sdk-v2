import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
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
// 只同步明确列出的 schema，复用正式来源与摘要链，不为每个新操作新增同步脚本。
const schemaFlag = process.argv.indexOf('--schemas'), scopeFlag = process.argv.indexOf('--scope');
if (schemaFlag >= 0 || scopeFlag >= 0) {
  assert.ok(schemaFlag >= 0 && scopeFlag >= 0 && !process.argv.includes('--platform-only'), '--schemas and --scope must be provided together without --platform-only');
  assert.ok(process.argv.length === 8 && Math.abs(schemaFlag - scopeFlag) === 2 && Math.min(schemaFlag, scopeFlag) === 4, 'Scoped sync accepts exactly one --schemas list and one --scope name');
  const names = (process.argv[schemaFlag + 1] ?? '').split(',');
  const scope = process.argv[scopeFlag + 1] ?? '';
  assert.ok(names.length && names.every(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) && new Set(names).size === names.length, '--schemas requires unique comma-separated schema names');
  assert.match(scope, /^[a-z][a-z0-9-]*$/, '--scope requires a lowercase scope name');
  const read = path => readFileSync(resolve(root, path));
  const hash = data => createHash('sha256').update(data).digest('hex');
  const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const lock = JSON.parse(read('contracts/upstream.json'));
  const provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
  assert.deepEqual(lock.schemaUpdates ?? [], provenance.schemaUpdates ?? [], 'Contract provenance differs');
  const updates = lock.schemaUpdates ?? [], previous = updates.find(item => item.scope === scope);
  assert.ok(!previous || updates.at(-1) === previous, 'Cannot replace a nonterminal schema overlay');
  if (previous) assert.deepEqual(previous.schemas, names, 'Cannot change the schemas of an existing scope');
  for (const [path, input] of Object.entries(lock.inputs)) assert.equal(hash(read(path)), input.sha256, `Unsynced input ${path}`);
  const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision, sourceKind: preview ? 'working-tree-preview' : 'committed', schemas: names, inputs: {} };
  const outputs = new Map();
  const operations = JSON.parse(read('contracts/uns-v2/manifest.json')).operations;
  // Swagger inlines request schemas when path parameters are removed from the JSON body.
  const inlineRequestSchemas = (name, current, incoming) => {
    const matches = operations.filter(operation => operation.request === name);
    return matches.map(operation => {
      const route = operation.path.split('/').map(part => part.startsWith(':') ? `{${part.slice(1)}}` : part).join('/');
      const method = operation.method.toLowerCase();
      const media = document => document.paths?.[route]?.[method]?.requestBody?.content?.['application/json'];
      const local = media(current), upstream = media(incoming);
      assert.ok(local?.schema && !local.schema.$ref && upstream?.schema && !upstream.schema.$ref,
        `Missing inline request schema ${name} for ${method.toUpperCase()} ${route}`);
      local.schema = structuredClone(upstream.schema);
      return local.schema;
    });
  };
  // Swagger 响应可能使用文档 schema 别名；从操作引用定位，不硬编码别名前缀。
  const responseSchemas = (name, current, incoming) => operations
    .filter(operation => operation.response === name)
    .map(operation => {
      const route = operation.path.split('/').map(part => part.startsWith(':') ? `{${part.slice(1)}}` : part).join('/');
      const method = operation.method.toLowerCase();
      const reference = document => document.paths?.[route]?.[method]?.responses?.['200']?.content?.['application/json']?.schema?.$ref;
      const local = reference(current), upstream = reference(incoming);
      assert.ok(local?.startsWith('#/components/schemas/') && local === upstream,
        `Missing or changed response schema reference ${name} for ${method.toUpperCase()} ${route}`);
      const alias = local.slice('#/components/schemas/'.length);
      assert.ok(current.components.schemas[alias] && incoming.components.schemas[alias], `Missing response schema ${alias}`);
      current.components.schemas[alias] = structuredClone(incoming.components.schemas[alias]);
      return current.components.schemas[alias];
    });
  for (const [path, sourcePath] of Object.entries({
    'contracts/uns-v2/contract.json': 'service/unssvr/internal/domain/unsv2/contract_generated.go',
    'contracts/uns-v2/manifest.json': 'share/unscontract/manifest.json',
    'contracts/openapi-v2.source.json': 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',
  })) {
    const before = read(path), current = JSON.parse(before), raw = readSource(sourcePath);
    const incoming = path.endsWith('/contract.json')
      ? JSON.parse(JSON.parse(raw.toString().match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m)?.[1] ?? 'null'))
      : JSON.parse(raw);
    const target = current.schemas ?? current.components?.schemas, source = incoming?.schemas ?? incoming?.components?.schemas;
    assert.ok(target && source, `Missing schema map in ${path}`);
    const roots = names.flatMap(name => {
      if (!current.schemas && !target[name] && !source[name]) {
        const inline = inlineRequestSchemas(name, current, incoming);
        if (inline.length) return inline;
        const responses = responseSchemas(name, current, incoming);
        if (responses.length) return responses;
      }
      assert.ok(source[name] && target[name], `Missing existing schema ${name} in ${path}`);
      target[name] = structuredClone(source[name]);
      return [target[name]];
    });
    const visited = new Set();
    const checkRefs = value => {
      if (!value || typeof value !== 'object') return;
      if (value.$ref?.startsWith('#/components/schemas/')) {
        const name = value.$ref.slice('#/components/schemas/'.length);
        if (!visited.has(name)) {
          assert.ok(target[name] && source[name], `Missing dependency ${name} in ${path}`);
          assert.deepEqual(target[name], source[name], `Dependency differs: ${name} in ${path}; include it in --schemas`);
          visited.add(name); checkRefs(target[name]);
        }
      }
      for (const child of Object.values(value)) checkRefs(child);
    };
    for (const schema of roots) checkRefs(schema);
    // 每次追加前验证已有增量链，不能用新摘要掩盖中间断链。
    let expected;
    for (const item of updates) {
      const input = item.inputs?.[path];
      if (!input) continue;
      if (expected !== undefined) assert.equal(input.baseSHA256, expected, `Broken schema digest chain ${path}`);
      expected = input.resultSHA256;
    }
    if (expected !== undefined) assert.equal(expected, hash(before), `Broken final schema digest ${path}`);
    const after = path.endsWith('/contract.json') ? Buffer.from(JSON.stringify(current) + '\n') : json(current);
    assertNoRetiredStreamProbe(after.toString('utf8'), path);
    assertNoRetiredHTTPPush(after.toString('utf8'), path);
    assertNoRetiredControls(after.toString('utf8'), path);
    update.inputs[path] = { path: sourcePath, sourceSHA256: hash(raw), baseSHA256: previous?.inputs[path]?.baseSHA256 ?? hash(before), resultSHA256: hash(after) };
    lock.inputs[path] = { ...lock.inputs[path], sha256: hash(after) };
    outputs.set(path, after);
  }
  lock.schemaUpdates = [...updates.filter(item => item.scope !== scope), update];
  provenance.schemaUpdates = lock.schemaUpdates;
  provenance.sourceDerivedContractSHA256 = hash(outputs.get('contracts/uns-v2/contract.json'));
  outputs.set('contracts/upstream.json', json(lock));
  outputs.set('contracts/uns-v2/provenance.json', json(provenance));
  // 所有输入、依赖和已有摘要通过后才写入；失败校验不留下部分同步。
  for (const [path, data] of outputs) writeFileSync(resolve(root, path), data);
  console.log(`Synced ${scope} schemas from ${revision} (${update.sourceKind}).`);
  process.exit(0);
}
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
