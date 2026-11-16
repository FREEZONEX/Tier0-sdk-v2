import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Add only the member avatarUrl field (Tier0-Backend#1426), keeping the pinned
// platform source otherwise unchanged instead of pulling unrelated platform changes.
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref, 'Usage: sync-member-avatar.mjs <backend> <commit|--worktree>');
const git = (...args) => execFileSync('git', ['-C', backend, ...args], { maxBuffer: 64 << 20 });
const preview = ref === '--worktree', revision = git('rev-parse', `${preview ? 'HEAD' : ref}^{commit}`).toString().trim();
const upstream = path => preview ? readFileSync(resolve(backend, path)) : git('show', `${revision}:${path}`);
const read = path => readFileSync(resolve(root, path)), digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const lock = JSON.parse(read('contracts/upstream.json')), provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
assert.deepEqual(lock.schemaUpdates, provenance.schemaUpdates);
const scope = 'member-avatar', schemas = ['PlatformPlatformMemberResp', 'PlatformAppAccessMemberResp'];
const previous = lock.schemaUpdates?.find(item => item.scope === scope);
assert.ok(!previous || lock.schemaUpdates.at(-1) === previous, 'Cannot replace a nonterminal overlay');
const path = 'contracts/openapi-v2.source.json', sourcePath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
const before = read(path); assert.equal(digest(before), lock.inputs[path].sha256, `Unsynced input ${path}`);
const raw = upstream(sourcePath), incoming = JSON.parse(raw).components.schemas, current = JSON.parse(before);
const withoutAvatar = schema => ({ ...schema, properties: Object.fromEntries(Object.entries(schema.properties).filter(([name]) => name !== 'avatarUrl')),
  required: schema.required.filter(name => name !== 'avatarUrl') });
for (const name of schemas) {
  const source = incoming[name], target = current.components.schemas[name];
  assert.equal(source.properties.avatarUrl?.type, 'string', `${name}.avatarUrl must be a string`);
  assert.ok(source.required.includes('avatarUrl'), `${name}.avatarUrl must always be present`);
  // The avatar work cannot silently pull in another member contract change.
  assert.deepEqual(withoutAvatar(source), withoutAvatar(target), `${name} differs beyond avatarUrl`);
  current.components.schemas[name] = structuredClone(source);
}
const after = json(current);
const update = { scope, repository: 'FREEZONEX/Tier0-Backend', revision, sourceKind: preview ? 'working-tree-preview' : 'committed',
  schemas: schemas.map(name => `${name}.avatarUrl`),
  inputs: { [path]: { path: sourcePath, sourceSHA256: digest(raw), baseSHA256: previous?.inputs[path]?.baseSHA256 ?? digest(before), resultSHA256: digest(after) } } };
lock.inputs[path] = { ...lock.inputs[path], sha256: digest(after) };
lock.schemaUpdates = [...(lock.schemaUpdates ?? []).filter(item => item.scope !== scope), update];
provenance.schemaUpdates = lock.schemaUpdates;
for (const [file, data] of [[path, after], ['contracts/upstream.json', json(lock)], ['contracts/uns-v2/provenance.json', json(provenance)]]) {
  writeFileSync(resolve(root, file), data);
}
console.log(`Synced ${scope} at ${revision} (${update.sourceKind}).`);
