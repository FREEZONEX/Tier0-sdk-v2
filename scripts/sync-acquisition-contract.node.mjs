import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { acquisitionSchemas, projectAcquisition, verifyAcquisition } from './sync-acquisition-contract.mjs';

test('采集投影保留共享模型，只允许已有引用', () => {
  const current = JSON.parse(readFileSync(new URL('../contracts/uns-v2/manifest.json', import.meta.url)));
  const upstream = structuredClone(current);
  upstream.schemas.CloudSourceDocument.properties.protocol.enum.push('unrelated-protocol');
  upstream.schemas.CloudSourceDocumentCreateReq.description = 'reviewed acquisition update';
  const actual = projectAcquisition(current, upstream);
  assert.deepEqual(actual.schemas.CloudSourceDocument, current.schemas.CloudSourceDocument);
  assert.equal(actual.schemas.CloudSourceDocumentCreateReq.description, 'reviewed acquisition update');
  for (const name of Object.keys(current.schemas).filter(name => !acquisitionSchemas.includes(name))) {
    assert.deepEqual(actual.schemas[name], current.schemas[name]);
  }
  upstream.schemas.CloudSourceDocumentCreateReq.properties.newDependency = { $ref: '#/components/schemas/CloudStreamDocument' };
  assert.throws(() => projectAcquisition(current, upstream), /New shared dependency/);
});

test('预览能验证但不能发布，变更快照后必须重新同步', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'tier0-acquisition-contract-'));
  try {
    mkdirSync(resolve(root, 'contracts/uns-v2'), { recursive: true });
    const path = 'contracts/uns-v2/manifest.json';
    const raw = '{}\n';
    writeFileSync(resolve(root, path), raw);
    const update = { scope: 'source-stream-acquisition', revision: 'a'.repeat(40), sourceKind: 'working-tree-preview',
      schemas: acquisitionSchemas, sourceSHA256: 'b'.repeat(64),
      inputs: { [path]: { resultSHA256: createHash('sha256').update(raw).digest('hex') } } };
    writeFileSync(resolve(root, 'contracts/uns-v2/provenance.json'), JSON.stringify({ schemaUpdates: [update] }));
    assert.deepEqual(verifyAcquisition(root), update);
    assert.throws(() => verifyAcquisition(root, true), /working-tree preview/);
    writeFileSync(resolve(root, path), '{"changed":true}\n');
    assert.throws(() => verifyAcquisition(root), /changed without sync/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a later recorded projection preserves acquisition verification while unrecorded edits fail', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'tier0-acquisition-projection-'));
  try {
    mkdirSync(resolve(root, 'contracts/uns-v2'), { recursive: true });
    const path = 'contracts/uns-v2/manifest.json';
    const digest = data => createHash('sha256').update(data).digest('hex');
    const acquisition = { scope:'source-stream-acquisition', revision:'a'.repeat(40), sourceKind:'committed', schemas:acquisitionSchemas,
      sourceSHA256:'b'.repeat(64), inputs:{ [path]:{resultSHA256:digest('before')} } };
    const seed = { scope:'app-seed/1', revision:'c'.repeat(40), sourceKind:'committed', inputs:{ [path]:{resultSHA256:digest('after')} } };
    writeFileSync(resolve(root,'contracts/uns-v2/provenance.json'), JSON.stringify({schemaUpdates:[acquisition,seed]}));
    writeFileSync(resolve(root,path),'after');
    assert.deepEqual(verifyAcquisition(root,true),acquisition);
    writeFileSync(resolve(root,path),'tampered');
    assert.throws(()=>verifyAcquisition(root,true), /changed without sync/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
