import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { patchRunSchema } from './sync-http-run-observations.mjs';

const current = JSON.parse(readFileSync(new URL('../contracts/uns-v2/manifest.json', import.meta.url))).schemas.CloudStreamRunsListResponse;
const item = schema => schema.properties.data.properties.items.items;
const base = structuredClone(current);
item(base).properties.kind.enum = ['delivery', 'control'];
delete item(base).properties.responseSentAt;

test('imports only the reviewed HTTP kind and optional nullable int64; leaves its inputs unchanged', () => {
  const frozen = structuredClone(base);
  assert.deepEqual(patchRunSchema(base, current), current);
  assert.deepEqual(base, frozen);
  assert.equal(item(current).required.includes('responseSentAt'), false);
  assert.deepEqual(patchRunSchema(current, current), current);
});

test('rejects additional run schema changes and weakened timestamp contracts', () => {
  for (const mutate of [
    schema => { item(schema).properties.status = { enum: ['guessed'] }; },
    schema => { item(schema).required.push('responseSentAt'); },
    schema => { item(schema).properties.responseSentAt.type = 'string'; },
    schema => { item(schema).properties.responseSentAt.nullable = false; },
    schema => { item(schema).properties.kind.enum.push('guessed'); },
  ]) {
    const changed = structuredClone(current); mutate(changed);
    assert.throws(() => patchRunSchema(base, changed));
  }
});
