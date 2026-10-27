import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!existsSync(npm)) throw new Error('Run this check through npm run check');
const run = (args, cwd = root) => execFileSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
mkdirSync(resolve(root, '.tmp'), { recursive: true });
const consumer = mkdtempSync(resolve(root, '.tmp/package-check-'));
const [archive] = JSON.parse(run([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', consumer]));
const files = new Set(archive.files.map(file => file.path));
for (const path of ['dist/esm/index.js', 'dist/cjs/index.js', 'dist/esm/index.d.ts', 'README.md', 'LICENSE', 'NOTICE.md']) {
  if (!files.has(path)) throw new Error(`Missing package file: ${path}`);
}
for (const path of files) if (/(^|\/)(node_modules|\.env|contracts|\.git|\.tmp)(\/|$)/.test(path)) throw new Error(`Unexpected package file: ${path}`);
writeFileSync(resolve(consumer, 'package.json'), JSON.stringify({ name: 'sdk-package-consumer', private: true, type: 'module' }));
run([npm, 'install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps', resolve(consumer, archive.filename)], consumer);
const installed = resolve(consumer, 'node_modules/@tier0/sdk-v2');
for (const path of files) {
  if (path.endsWith('.js.map')) {
    const map = JSON.parse(readFileSync(resolve(installed, path), 'utf8'));
    if (!map.sourcesContent?.length || map.sourcesContent.some(source => typeof source !== 'string')) throw new Error(`Unusable packed source map: ${path}`);
  }
  if (path.endsWith('.d.ts.map')) throw new Error(`Declaration map points outside the package: ${path}`);
}
run(['scripts/check-skills.mjs', installed]);
run(['scripts/check-skill-examples.mjs', installed]);
const pkg = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
for (const [path, entry] of Object.entries(pkg.exports)) {
  if (typeof entry === 'string') continue;
  for (const mode of ['import', 'require']) {
    for (const file of Object.values(entry[mode])) if (!existsSync(resolve(installed, file))) throw new Error(`Missing ${mode} export: ${file}`);
    const specifier = '@tier0/sdk-v2' + (path === '.' ? '' : path.slice(1));
    run(mode === 'import' ? ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`] : ['-e', `require(${JSON.stringify(specifier)})`], consumer);
  }
}
run(['--input-type=module', '-e', `
  import { createClient, createUnsV2Client, UNS_V2_OPERATIONS, UNS_V2_CONTRACT_PROVENANCE } from '@tier0/sdk-v2';
  import * as sdk from '@tier0/sdk-v2';
  const client = createClient({ apiHost: 'https://fixture.invalid' });
  if ('getCurrentProjectId' in sdk || 'flow' in client || 'launchpad' in client.api) throw new Error('Legacy API leaked');
  const operations = Object.keys(UNS_V2_OPERATIONS);
  const raw = createUnsV2Client();
  if (operations.length !== UNS_V2_CONTRACT_PROVENANCE.publicOperationCount || operations.some(name => typeof raw[name] !== 'function')) throw new Error('Missing generated operations');
  if (typeof client.uns.metadataFind !== 'function' || typeof client.uns.metadataBulkWrite !== 'function') throw new Error('Missing metadata operations');
  if ('collectionCreate' in client.uns || 'metaBatchExecute' in client.uns) throw new Error('Retired metadata routes leaked');
  if ('sourceList' in client.uns || 'streamProgramDeploy' in client.uns || 'controlInvoke' in client.uns) throw new Error('Mixed domain entrypoints');
  if ('list' in client.source || 'get' in client.stream.programs || 'nodes' in client.agent || 'controls' in client.api) throw new Error('Retired facade aliases leaked');
  if (['sourceList', 'streamProgramCreate', 'recordInsertMany', 'recordDistinct', 'metadataFindOne'].some(name => name in raw)) throw new Error('Retired raw operations leaked');
  if ('runtime' in client.stream || 'streamRuntimeCapabilitiesGet' in raw || 'streamRuntimeCapabilitiesGet' in UNS_V2_OPERATIONS) throw new Error('Retired readiness probe leaked');
  if (typeof client.source.documents.get !== 'function' || typeof client.stream.programs.deploy !== 'function') throw new Error('Missing domain entrypoints');
`], consumer);
for (const ext of ['mts', 'cts']) writeFileSync(resolve(consumer, `consumer.${ext}`), `
import { createClient, type Tier0Client } from '@tier0/sdk-v2';
import { Tier0MQClient } from '@tier0/sdk-v2/mq';
import { createSourceClient } from '@tier0/sdk-v2/source';
import { createStreamClient } from '@tier0/sdk-v2/stream';
import { createDataClient, type Doc } from '@tier0/sdk-v2/data';
import { compileCollection, defineCollection, type Doc as DeclaredDoc } from '@tier0/sdk-v2/data/define';
import { z } from 'zod';
const orders = defineCollection({ alias: 'orders', schema: z.object({ code: z.string() }) });
const declared: DeclaredDoc<typeof orders> | undefined = undefined;
void declared;
void compileCollection(orders);
const order: Promise<Doc<typeof orders> | null> = createDataClient({ collections: [orders] }).collection(orders).findOne({ code: 'A' });
void order;
const handle = createDataClient({ collections: [orders] }).collection(orders);
const plainInsert: Promise<{ insertedId: string }> = handle.insertOne({ code: 'A' });
const insertSnapshot: Promise<{ insertedId: string; value: Doc<typeof orders> }> = handle.insertOne({ code: 'A' }, { returnDocument: 'after' });
void [plainInsert, insertSnapshot];
const nested = defineCollection({ alias: 'nested', schema: z.object({
  code: z.string(), customer: z.object({ name: z.string(), email: z.string() }),
  lines: z.array(z.object({ sku: z.string(), quantity: z.number() })),
}) });
const nestedHandle = createDataClient({ collections: [nested] }).collection(nested);
const input = { code: 'A', customer: { name: 'A', email: 'a@example.invalid' }, lines: [{ sku: 'A', quantity: 1 }] };
const fullSnapshot: Promise<{ insertedId: string; value: Doc<typeof nested> }> = nestedHandle.insertOne(input, { returnDocument: 'after' });
void fullSnapshot;
nestedHandle.insertOne(input, { returnDocument: 'after', projection: { 'customer.name': 1, 'lines.sku': 1 } }).then(result => {
  const revision: number = result.value._meta.revision;
  const id: string = result.value._id;
  // @ts-expect-error projected top-level fields may be missing
  const code: string = result.value.code;
  if (result.value.customer) {
    // @ts-expect-error nested fields remain optional after narrowing the parent
    const email: string = result.value.customer.email;
    void email;
  }
  if (result.value.lines?.[0]) {
    // @ts-expect-error nested fields in array elements may also be omitted
    const quantity: number = result.value.lines[0].quantity;
    void quantity;
  }
  void [revision, id, code];
});
const client: Tier0Client = createClient({ apiHost: 'https://fixture.invalid' });
client.uns.recordFind({ collectionId: 'orders' });
client.uns.recordInsertOne({ collectionId: 'orders', data: { code: 'A' }, returnDocument: 'after' });
client.uns.metadataFind({ kind: 'collection', filter: { _id: 'orders' } });
createSourceClient().documents.list({});
createStreamClient().programs.list({});
// @ts-expect-error The retired readiness probe cannot return through packed declarations.
createStreamClient().runtime.capabilities({});
client.mqttAuth.delete({ id: 9007199254740993n });
// @ts-expect-error Retired low-level aliases cannot silently select a new operation.
client.uns.metadataFindOne({ kind: 'collection' });
// @ts-expect-error Native Source projections are retired.
client.source.list({});
// @ts-expect-error Stream creation uses documents.create({ program }) now.
client.stream.programs.create({});
handle.insertMany([{ code: 'A' }], { idempotencyKey: 'bulk-intent' });
handle.findOneAndUpdate({ code: 'A' }, { $set: { code: 'B' } });
handle.findOneAndReplace({ code: 'A' }, { code: 'B' });
handle.findOneAndDelete({ code: 'A' });
handle.distinct('code');
void Tier0MQClient;
`);
run([resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.mts', 'consumer.cts'], consumer);
for (const subpath of ['', '/source', '/stream', '/mq', '/react', '/vue', '/data/define']) {
  const result = await build({ absWorkingDir: consumer, stdin: { contents: `export * from '@tier0/sdk-v2${subpath}';`, resolveDir: consumer }, bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  if (!subpath && Object.keys(result.metafile.inputs).some(path => /node_modules[\\/](mqtt|react|vue|zod)[\\/]|cloud-server|[\\/]data[\\/]/.test(path))) throw new Error('Root entry loads an optional browser/server dependency');
  if (subpath === '/data/define' && (Object.keys(result.metafile.inputs).some(path => /^node:|[\\/]data[\\/](context|bootstrap|call|client|collection|error)\.js$/.test(path)) ||
      result.outputFiles.some(file => file.text.includes('AsyncLocalStorage')))) throw new Error('@tier0/sdk-v2/data/define loads the server data runtime');
}
// The data layer is server-only: a browser bundle must fail on its Node built-ins instead of shipping it.
const dataBundle = await build({ absWorkingDir: consumer, stdin: { contents: `export * from '@tier0/sdk-v2/data';`, resolveDir: consumer }, bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' }).then(() => 'bundled', () => 'rejected');
if (dataBundle !== 'rejected') throw new Error('@tier0/sdk-v2/data must not bundle for the browser');
execFileSync(process.execPath, ['scripts/check-installed-tests.mjs', consumer], { cwd: root, stdio: 'inherit' });
console.log(`Verified packed ${pkg.name}@${pkg.version}: ESM/CJS runtime + declarations, browser bundles, server-only data entry, exports, bundled Skills and installed behavioral suite. Tarball: ${resolve(consumer, archive.filename)}`);
