import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';
import { assertNoRetiredStreamProbe } from './retired-stream-probe.mjs';
import { assertNoRetiredHTTPPush } from './retired-http-push.mjs';
import { assertNoRetiredControls } from './retired-controls.mjs';
import { platformSchemaProjection } from './platform-schema-projection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// The effective v2 contract is the only public route source. Legacy Swagger is not a fallback.
const source = JSON.parse(readFileSync(resolve(root, 'contracts/openapi-v2.source.json'), 'utf8'));
assertNoRetiredStreamProbe(source, 'contracts/openapi-v2.source.json');
assertNoRetiredHTTPPush(source, 'contracts/openapi-v2.source.json');
assertNoRetiredControls(source, 'contracts/openapi-v2.source.json');
if (!source.servers?.some(server => server.url === '/openapi/v2')) throw new Error('Expected the public v2 server');
const check = process.argv.includes('--check');
const paths = {};
for (const [path, item] of Object.entries(source.paths)) {
  // App 交互由 streams 类型化客户端提供，避免重复生成无生命周期的接口。
  if (path.startsWith('/stream-requests/') || path.startsWith('/stream-messages/')) continue;
  for (const [method, operation] of Object.entries(item)) {
    if (!operation['x-tier0-platform']) continue;
    if (operation.deprecated) throw new Error(`Deprecated platform route: ${path}`);
    const copy = structuredClone(operation);
    delete copy['x-tier0-source-operation'];
    (paths['/openapi/v2' + path] ??= {})[method] = copy;
  }
}
// Retain the SDK's stable schema names while taking their definitions from v2.
const platformSchemas = platformSchemaProjection(source.components.schemas, paths);
const spec = JSON.parse(JSON.stringify({ ...source, servers: [{ url: '/' }], paths, components: { ...source.components, schemas: platformSchemas } })
  .replaceAll('#/components/schemas/Platform', '#/components/schemas/'));
const schemas = spec.components.schemas;
// v2 includes the runtime envelope. Normalize integer formats for exact codecs.
// All integer fields use exact signed 64-bit handling; safe values remain numbers.
const q = JSON.stringify;
const camel = s => s.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const responseRef = op => op.responses?.['200']?.content?.['application/json']?.schema;
const operations = [];
const tree = {};
for (const [path, item] of Object.entries(spec.paths)) {
  if (!path.startsWith('/openapi/v2/')) throw new Error(`Unclassified non-public path: ${path}`);
  for (const [method, op] of Object.entries(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const parts = path.slice('/openapi/v2/'.length).split('/').filter(x => !x.startsWith('{')).map(camel);
    if (parts[0] === 'auth') parts[0] = 'system';
    if (parts[0] === 'info') parts.splice(0, 1, 'system', 'info');
    if (parts[0] === 'platform') parts.splice(0, 2, 'members', 'listWorkspace');
    if (parts.join('/') === 'apps/accessMembers/list') parts.splice(0, 3, 'members', 'listApp');
    if (parts.join('/') === 'assets/files') parts.push('prepareUpload');
    const name = parts.map((p, i) => i ? p[0].toUpperCase() + p.slice(1) : p).join('');
    if (operations.some(o => o.name === name)) throw new Error(`Duplicate SDK method: ${name}`);
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
    const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])];
    if (parameters.some(p => !['query', 'path'].includes(p.in))) throw new Error(`Unsupported parameters at ${path}`);
    const query = parameters.filter(p => p.in === 'query');
    const queryName = `Sdk${name}Query`;
    if (query.length) schemas[queryName] = { type: 'object', properties: Object.fromEntries(query.map(p => [p.name, p.schema])), required: query.filter(p => p.required).map(p => p.name) };
    const body = op.requestBody?.content?.['application/json']?.schema;
    if (op.requestBody && !body) throw new Error(`Unsupported request content type at ${path}`);
    const requestName = `Sdk${name}Request`;
    if (body) schemas[requestName] = body;
    const responseName = `Sdk${name}Data`;
    const wire = responseRef(op) ?? {};
    const mode = path.endsWith('/files/download') ? 'download' : /^\/openapi\/v2\/(notifications|capabilities)\//.test(path) ? 'direct' : 'envelope';
    if (mode === 'envelope' && !wire.properties?.data) throw new Error(`Missing v2 response envelope at ${path}`);
    schemas[responseName] = mode === 'envelope' ? wire.properties.data : wire;
    const wireName = `Sdk${name}Wire`;
    schemas[wireName] = mode === 'envelope' ? { type: 'object', required: ['code', 'msg', 'data'], properties: { code: { type: 'integer' }, msg: { type: 'string' }, data: ref(responseName) } } : ref(responseName);
    // Normalize the published schema to the actual JSON response; never double-wrap direct APIs.
    if (mode !== 'download') op.responses['200'].content['application/json'].schema = ref(wireName);
    const readonly = method === 'get' || ['whoami', 'info', 'get', 'list', 'listWorkspace', 'listApp', 'discover', 'describe'].includes(parts.at(-1));
    const operation = { name, method: method.toUpperCase(), path, pathParams, mode, readonly,
      requestSchema: body ? `Platform_${requestName}` : undefined, responseSchema: `Platform_${wireName}` };
    operations.push(operation);
    const args = [];
    if (pathParams.length) args.push(`params: { ${pathParams.map(p => `${q(p)}: string`).join('; ')} }`);
    const resolveSchema = schema => schema?.$ref ? schemas[schema.$ref.split('/').at(-1)] : schema;
    if (query.length) args.push(`query${query.some(p => p.required) ? '' : '?'}: components['schemas'][${q(queryName)}]`);
    if (body) args.push(`body${resolveSchema(body)?.required?.length ? '' : '?'}: components['schemas'][${q(requestName)}]`);
    args.push('options?: RequestOptions');
    const input = `{ ${[pathParams.length ? 'params' : '', query.length ? 'query' : '', body ? 'body' : ''].filter(Boolean).join(', ')} }`;
    const type = mode === 'download' ? 'Response' : `components['schemas'][${q(responseName)}]`;
    let target = tree;
    for (const part of parts.slice(0, -1)) target = target[part] ??= {};
    if (target[parts.at(-1)]) throw new Error(`Duplicate method path: ${parts.join('.')}`);
    target[parts.at(-1)] = `(${args.join(', ')}) => http.operation<${type}>(OPENAPI_OPERATIONS[${q(name)}], ${input}, options)`;
  }
}
// Keep only schemas reachable from public requests/responses and operation aliases.
const reachable = new Set();
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref?.startsWith('#/components/schemas/')) {
    const name = value.$ref.split('/').at(-1);
    if (!Object.hasOwn(schemas, name)) throw new Error(`Unknown schema: ${name}`);
    if (!reachable.has(name)) { reachable.add(name); collect(schemas[name]); }
  }
  for (const v of Object.values(value)) collect(v);
}
collect(spec.paths);
for (const name of Object.keys(schemas).filter(n => n.startsWith('Sdk'))) collect(ref(name));
spec.components.schemas = Object.fromEntries(Object.entries(schemas).filter(([n]) => reachable.has(n)));
function codec(s) {
  if (!s || typeof s !== 'object') return {};
  if (s.$ref) return { r: 'Platform_' + s.$ref.split('/').at(-1) };
  if (s.type === 'integer') return { k: 'i' };
  if (s.type === 'number') return { k: 'n' };
  if (s.type === 'array') return { k: 'a', i: codec(s.items) };
  const composed = s.oneOf ?? s.anyOf ?? s.allOf;
  if (composed) return { k: 'u', a: composed.map(codec) };
  if (s.type === 'object' || s.properties || s.additionalProperties) return { k: 'o', p: Object.fromEntries(Object.entries(s.properties ?? {}).map(([n, p]) => [n, codec(p)])), ...(typeof s.additionalProperties === 'object' ? { x: codec(s.additionalProperties) } : {}) };
  return {};
}
const types = astToString(await openapiTS(spec, { defaultNonNullable: false, transform(schema) {
  if (schema.enum) return;
  if (schema.type === 'integer') return ts.factory.createUnionTypeNode([ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), ts.factory.createKeywordTypeNode(ts.SyntaxKind.BigIntKeyword)]);
  if (schema.type === 'number') return ts.factory.createUnionTypeNode([ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), ts.factory.createTypeReferenceNode('UnsV2RawNumber')]);
} }));
function objectCode(node, level = 1) {
  return '{\n' + Object.entries(node).map(([key, v]) => '  '.repeat(level) + q(key) + ': ' + (typeof v === 'string' ? v : objectCode(v, level + 1)) + ',').join('\n') + '\n' + '  '.repeat(level - 1) + '}';
}
const outputs = {
  'contracts/openapi-platform.normalized.json': JSON.stringify(spec, null, 2) + '\n',
  'contracts/coverage.json': JSON.stringify({ platformPublicPaths: Object.keys(spec.paths).length, unsPublicOperations: JSON.parse(readFileSync(resolve(root, 'contracts/uns-v2/manifest.json'))).operations.filter(o => !o.coreOnly).length }, null, 2) + '\n',
  'src/openapi/types.generated.ts': "// Generated. Do not edit.\nimport type { UnsV2RawNumber } from '../uns-v2/codec.js';\n" + types,
  'src/openapi/codecs.generated.ts': '// Generated. Do not edit.\nexport const PLATFORM_CODEC_SCHEMAS = ' + JSON.stringify(Object.fromEntries(Object.entries(spec.components.schemas).map(([name, schema]) => [`Platform_${name}`, codec(schema)]))) + ' as const;\n',
  'src/openapi/api.generated.ts': `// Generated. Stable names follow public resource paths, not goctl operationId.\nimport type { HttpClient, RequestOptions } from './client.js';\nimport type { components } from './types.generated.js';\n\nexport const OPENAPI_OPERATIONS = ${JSON.stringify(Object.fromEntries(operations.map(o => [o.name, o])), null, 2)} as const;\n\nexport function createOpenAPI(http: HttpClient) {\n  return ${objectCode(tree)};\n}\nexport type OpenAPI = ReturnType<typeof createOpenAPI>;\n`,
};
for (const [file, content] of Object.entries(outputs)) {
  if (check) { if (readFileSync(resolve(root, file), 'utf8') !== content) throw new Error(`Stale generated file: ${file}`); }
  else { mkdirSync(resolve(root, file, '..'), { recursive: true }); writeFileSync(resolve(root, file), content); }
}
console.log(`${check ? 'Verified' : 'Generated'} ${operations.length} platform v2 public operations; coverage recorded in contracts/coverage.json.`);
