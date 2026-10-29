import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const runItem = schema => schema.properties.data.properties.items.items;

// Keep the released contract while importing only the two reviewed HTTP fields.
export function patchRunSchema(current, upstream) {
  const result = structuredClone(current);
  const before = runItem(current), after = runItem(upstream);
  assert.deepEqual(after.properties.kind.enum, ['delivery', 'request', 'http']);
  assert.deepEqual(after.properties.responseSentAt, { type: 'integer', format: 'int64', nullable: true, minimum: 0 });
  assert.equal(after.required.includes('responseSentAt'), false);
  const withoutHTTP = schema => {
    const copy = structuredClone(schema), item = runItem(copy);
    item.properties.kind.enum = item.properties.kind.enum.filter(value => value !== 'http');
    delete item.properties.responseSentAt;
    return copy;
  };
  assert.deepEqual(withoutHTTP(current), withoutHTTP(upstream), 'Unreviewed Stream runs schema changes');
  runItem(result).properties.kind = structuredClone(after.properties.kind);
  runItem(result).properties.responseSentAt = structuredClone(after.properties.responseSentAt);
  return result;
}

export function syncHTTPRunObservations(backend, ref) {
  if (!backend || !ref) throw new Error('Usage: node scripts/sync-http-run-observations.mjs <backend checkout> <commit>');
  const git = (...args) => execFileSync('git', ['-C', resolve(backend), ...args], { maxBuffer: 50 * 1024 * 1024 });
  const revision = git('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const lock = JSON.parse(read('contracts/upstream.json'));
  const provenance = JSON.parse(read('contracts/uns-v2/provenance.json'));
  const targets = [
    ['contracts/uns-v2/manifest.json', 'share/unscontract/manifest.json', 'schemas', 'CloudStreamRunsListResponse'],
    ['contracts/openapi-v2.source.json', 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json', 'components.schemas', 'DocUnsV2StreamRunsListResponse'],
  ];
  const update = { revision, schemas: ['CloudStreamRunsListResponse'], fields: ['items.kind:http', 'items.responseSentAt'], inputs: {} };
  const outputs = new Map();
  for (const [local, remote, section, name] of targets) {
    const original = read(local), upstreamText = git('show', `${revision}:${remote}`).toString();
    assert.equal(hash(original), lock.inputs[local].sha256, `Unsynced input: ${local}`);
    const current = JSON.parse(original), upstream = JSON.parse(upstreamText);
    const schemas = value => section === 'schemas' ? value.schemas : value.components.schemas;
    schemas(current)[name] = patchRunSchema(schemas(current)[name], schemas(upstream)[name]);
    const output = json(current);
    update.inputs[local] = { path: remote, schema: name, sourceSHA256: hash(upstreamText), baseSHA256: hash(original), resultSHA256: hash(output) };
    lock.inputs[local] = { ...lock.inputs[local], sha256: hash(output) };
    outputs.set(local, output);
  }
  // Idempotent regeneration does not append duplicate provenance or move the base pin.
  const previous = lock.schemaUpdates?.at(-1);
  if (previous?.revision === revision && Object.values(update.inputs).every(input => input.baseSHA256 === input.resultSHA256)) return;
  lock.schemaUpdates = [...(lock.schemaUpdates || []), update];
  provenance.schemaUpdates = lock.schemaUpdates;
  outputs.set('contracts/upstream.json', json(lock));
  outputs.set('contracts/uns-v2/provenance.json', json(provenance));
  for (const [path, output] of outputs) writeFileSync(resolve(root, path), output);
  console.log(`Imported HTTP run observations at ${revision}; base ${lock.revision} otherwise unchanged. Run npm run generate.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncHTTPRunObservations(...process.argv.slice(2));
