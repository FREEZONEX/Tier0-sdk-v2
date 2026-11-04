import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import openapiTS from 'openapi-typescript';

function assertLocalReferencesResolve(document, roots) {
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string') {
      assert.ok(value.$ref.startsWith('#/'), `unsupported external reference: ${value.$ref}`);
      if (seen.has(value.$ref)) return;
      seen.add(value.$ref);
      let target = document;
      for (const part of value.$ref.slice(2).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        assert.ok(target && Object.hasOwn(target, key), `unresolved reference: ${value.$ref}`);
        target = target[key];
      }
      visit(target);
    }
    for (const child of Object.values(value)) visit(child);
  }
  for (const root of roots) visit(root);
}

test('projected OpenAPI references resolve and openapi-typescript accepts them', async () => {
  const path = new URL('../contracts/openapi-v2.source.json', import.meta.url);
  const document = JSON.parse(await readFile(path, 'utf8'));
  assertLocalReferencesResolve(document, [document.paths['/uns/app/collections/seed:register'], document.paths['/uns/app/collections/seed:apply']]);
  await openapiTS(path);
});

test('missing transitive schema is rejected', () => {
  const broken = { paths: { '/test': { $ref: '#/components/schemas/Missing' } }, components: { schemas: {} } };
  assert.throws(() => assertLocalReferencesResolve(broken, [broken.paths['/test']]), /unresolved reference/);
});
