// Run against the unpacked npm tarball, not the source tree. All HTTP is mocked.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const packageDir = process.argv[2];
if (!packageDir) throw new Error('Usage: node scripts/check-http-run-package.mjs <unpacked package directory>');
const esm = await import(pathToFileURL(resolve(packageDir, 'dist/esm/index.js')));
const cjs = createRequire(import.meta.url)(resolve(packageDir, 'dist/cjs/index.js'));
for (const [format, { createClient }] of [['ESM', esm], ['CJS', cjs]]) {
for (const [status, field, expected] of [
  ['admitted', '', undefined],
  ['unknown', ',"responseSentAt":null', null],
  ['response-sent', ',"responseSentAt":1793210000000', 1793210000000],
  ['response-sent', ',"responseSentAt":9223372036854775807', 9223372036854775807n],
]) {
  let calls = 0;
  const sdk = createClient({ apiHost: 'https://offline.invalid', apiKey: 'offline-fixture', fetch: async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://offline.invalid/openapi/v2/uns/streams/runs/list');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { id: '7' });
    return new Response('{"code":200,"msg":"","requestId":"offline","data":{"items":[{"id":"http:fixture","kind":"http","release":"3","entryId":"entry","trigger":"http-request","status":"' + status + '","createdAt":1793200000000,"finishedAt":null,"durationMs":null' + field + '}],"nextCursor":"","checkedAt":1793210000000}}');
  } });
  const response = await sdk.stream.runs.list({ id: '7' });
  const run = response.data.items[0];
  assert.equal(calls, 1);
  assert.equal(run.kind, 'http');
  assert.equal(run.status, status);
  assert.equal(run.responseSentAt, expected);
  assert.equal(Object.hasOwn(run, 'responseSentAt'), expected !== undefined);
  assert.equal(run.finishedAt, null);
  console.log(`Packed SDK ${format} HTTP run ${status}: ${typeof expected}, exact timestamp retained.`);
}
}
