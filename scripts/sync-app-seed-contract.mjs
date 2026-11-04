// Import only the experimental App seed wire contract from a committed Backend.
// Other Source/Namespace contracts remain pinned to their reviewed baseline.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const [backend, ref] = process.argv.slice(2);
assert.ok(backend && ref && ref !== '--worktree', 'Usage: sync-app-seed-contract.mjs <backend> <committed-ref>');
const git = (...args) => execFileSync('git', ['-C', resolve(backend), ...args], {maxBuffer:50*1024*1024});
const revision = git('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
assert.match(revision, /^[a-f0-9]{40}$/);
const source = path => git('show', `${revision}:${path}`).toString('utf8');
const read = path => readFileSync(resolve(root, path));
const hash = value => createHash('sha256').update(value).digest('hex');
const pretty = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const names = ['appCollectionsSeedRegister','appCollectionsSeedApply'];
const schemas = ['CloudAppSeedRegisterReq','CloudAppSeedRegisterResponse','CloudAppSeedApplyReq','CloudAppSeedApplyResponse'];
const paths = ['/uns/app/collections/seed:register','/uns/app/collections/seed:apply'];
const sources = {
 manifest:source('share/unscontract/manifest.json'),
 generated:source('service/unssvr/internal/domain/unsv2/contract_generated.go'),
 registry:source('share/unscontract/registry_generated.go'),
 swagger:source('service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json'),
};
const sourceManifest=JSON.parse(sources.manifest), sourceSwagger=JSON.parse(sources.swagger);
const match=sources.generated.match(/^const ContractJSON = ("(?:\\[\s\S]|[^"\\])*")\r?$/m);
assert.ok(match,'missing generated contract'); const sourceContractRaw=JSON.parse(match[1])+'\n'; const sourceContract=JSON.parse(sourceContractRaw);
const lock=JSON.parse(read('contracts/upstream.json')); const provenance=JSON.parse(read('contracts/uns-v2/provenance.json'));
assert.ok(!(lock.schemaUpdates||[]).some(update=>update.scope==='app-seed/1'),'seed projection already present');
const outputs=new Map();
for (const [path, upstream] of [['contracts/uns-v2/manifest.json',sourceManifest],['contracts/uns-v2/contract.json',sourceContract]]) {
 const before=read(path); assert.equal(hash(before),lock.inputs[path].sha256,`unsynced ${path}`);
 const current=JSON.parse(before);
 assert.deepEqual(current.schemas.CloudAppCollectionDeclaration,upstream.schemas.CloudAppCollectionDeclaration,'seed declaration dependency changed');
 for (const name of schemas) { assert.ok(!current.schemas[name] && upstream.schemas[name],name); current.schemas[name]=upstream.schemas[name]; }
 for (const name of names) { assert.ok(!current.operations.some(op=>op.name===name),name); const op=upstream.operations.find(op=>op.name===name); assert.ok(op,name); current.operations.push(op); }
 outputs.set(path,Buffer.from(path.endsWith('/contract.json') ? JSON.stringify(current)+'\n' : JSON.stringify(current,null,2)+'\n'));
}
{
 const path='contracts/openapi-v2.source.json', before=read(path); assert.equal(hash(before),lock.inputs[path].sha256);
 const current=JSON.parse(before);
 assert.deepEqual(current.components.schemas.CloudAppCollectionDeclaration,sourceSwagger.components.schemas.CloudAppCollectionDeclaration,'OpenAPI declaration dependency changed');
 for(const name of paths) { assert.ok(!current.paths[name] && sourceSwagger.paths[name],name); current.paths[name]=sourceSwagger.paths[name]; }
 // Copy the transitive schema closure, and reject changed shared definitions.
 const seen = new Set();
 function includeRefs(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
   const match = /^#\/components\/schemas\/([^/]+)$/.exec(value.$ref);
   assert.ok(match, `unsupported seed reference ${value.$ref}`);
   const name = match[1];
   if (!seen.has(name)) {
    seen.add(name);
    const schema = sourceSwagger.components.schemas[name];
    assert.ok(schema, `missing upstream schema ${name}`);
    if (current.components.schemas[name]) assert.deepEqual(current.components.schemas[name], schema, `changed shared schema ${name}`);
    else current.components.schemas[name] = schema;
    includeRefs(schema);
   }
  }
  for (const child of Object.values(value)) includeRefs(child);
 }
 for (const name of paths) includeRefs(current.paths[name]);
 outputs.set(path,pretty(current));
}
{
 const path='contracts/uns-v2/registry_generated.go', before=read(path); assert.equal(hash(before),lock.inputs[path].sha256);
 let raw=before.toString('utf8'); const lines=names.map(name=>{const line=sources.registry.split('\n').find(line=>line.includes(`Name: "${name}"`)); assert.ok(line,name); return line;});
 assert.ok(!names.some(name=>raw.includes(`Name: "${name}"`)));
 assert.match(raw,/\n}\n$/); raw=raw.replace(/\n}\n$/, `\n${lines.join('\n')}\n}\n`); outputs.set(path,Buffer.from(raw));
}
const update={scope:'app-seed/1',repository:'FREEZONEX/Tier0-Backend',revision,sourceKind:'committed',operations:names,schemas,inputs:{}};
const inputSources={'contracts/uns-v2/manifest.json':['share/unscontract/manifest.json',sources.manifest], 'contracts/uns-v2/contract.json':['service/unssvr/internal/domain/unsv2/contract_generated.go#ContractJSON',sourceContractRaw], 'contracts/uns-v2/registry_generated.go':['share/unscontract/registry_generated.go',sources.registry], 'contracts/openapi-v2.source.json':['service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json',sources.swagger]};
for(const [path,after] of outputs) {
 const [upstream,raw]=inputSources[path]; update.inputs[path]={path:upstream,sourceSHA256:hash(raw),baseSHA256:hash(read(path)),resultSHA256:hash(after)};
 lock.inputs[path].sha256=hash(after);
}
provenance.schemaUpdates=[...(provenance.schemaUpdates||[]),update]; lock.schemaUpdates=provenance.schemaUpdates;
provenance.sourceDerivedContractSHA256=hash(outputs.get('contracts/uns-v2/contract.json'));
provenance.note='Pinned base with independently recorded acquisition and App seed projections; other contract inputs retain their baseline.';
for(const [path,data] of outputs) writeFileSync(resolve(root,path),data);
writeFileSync(resolve(root,'contracts/upstream.json'),pretty(lock)); writeFileSync(resolve(root,'contracts/uns-v2/provenance.json'),pretty(provenance));
console.log(`Projected only app-seed/1 from Backend ${revision}`);
