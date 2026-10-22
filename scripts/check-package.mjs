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
  import { createClient, createUnsV2Client, UNS_V2_OPERATIONS } from '@tier0/sdk-v2';
  import * as sdk from '@tier0/sdk-v2';
  const client = createClient({ apiHost: 'https://fixture.invalid' });
  if ('getCurrentProjectId' in sdk || 'flow' in client || 'launchpad' in client.api) throw new Error('Legacy API leaked');
  const operations = Object.keys(UNS_V2_OPERATIONS);
  const raw = createUnsV2Client();
  if (operations.length !== 98 || operations.some(name => typeof raw[name] !== 'function')) throw new Error('Missing generated operations');
  if ('sourceList' in client.uns || 'streamProgramDeploy' in client.uns || 'controlInvoke' in client.uns) throw new Error('Mixed domain entrypoints');
  if (typeof client.source.documents.get !== 'function' || typeof client.stream.programs.deploy !== 'function') throw new Error('Missing domain entrypoints');
`], consumer);
for (const ext of ['mts', 'cts']) writeFileSync(resolve(consumer, `consumer.${ext}`), `
import { createClient, type Tier0Client } from '@tier0/sdk-v2';
import { Tier0MQClient } from '@tier0/sdk-v2/mq';
import { createSourceClient } from '@tier0/sdk-v2/source';
import { createStreamClient } from '@tier0/sdk-v2/stream';
const client: Tier0Client = createClient({ apiHost: 'https://fixture.invalid' });
client.uns.recordFind({ collectionId: 'orders' });
createSourceClient().documents.list({});
createStreamClient().programs.list({});
client.mqttAuth.delete({ id: 9007199254740993n });
void Tier0MQClient;
`);
run([resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.mts', 'consumer.cts'], consumer);
for (const subpath of ['', '/source', '/stream', '/mq', '/react', '/vue']) {
  const result = await build({ absWorkingDir: consumer, stdin: { contents: `export * from '@tier0/sdk-v2${subpath}';`, resolveDir: consumer }, bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  if (!subpath && Object.keys(result.metafile.inputs).some(path => /node_modules[\\/](mqtt|react|vue)[\\/]|cloud-server/.test(path))) throw new Error('Root entry loads an optional browser/server dependency');
}
execFileSync(process.execPath, ['scripts/check-installed-tests.mjs', consumer], { cwd: root, stdio: 'inherit' });
console.log(`Verified packed ${pkg.name}@${pkg.version}: ESM/CJS runtime + declarations, browser bundles, exports, bundled Skills and installed behavioral suite. Tarball: ${resolve(consumer, archive.filename)}`);
