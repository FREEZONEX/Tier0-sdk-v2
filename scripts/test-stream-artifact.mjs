import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

// Install the actual npm tarball into an independent consumer, without a broker mock.
// Native fixture uses production Go issuer with fixed authority, not SYS/GW E2E.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(process.env.TIER0_STREAM_MESSAGES_FIXTURE_URL, 'Run through test:streams:artifact');
const directory = await mkdtemp(join(tmpdir(), 'tier0-sdk-stream-artifact-'));
const runtimeKey = Symbol.for('tier0.sdk.app-runtime.v1');
try {
  const npm = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const run = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', maxBuffer: 10 << 20 });
  const [archive] = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'stream-artifact-consumer', private: true, type: 'module' }));
  run(['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps', join(directory, archive.filename)], directory);
  const runtime = directory;
  const require = createRequire(join(runtime, 'probe.cjs'));
  const esm = await import(pathToFileURL(join(runtime, 'node_modules/@tier0/sdk-v2/dist/esm/index.js')).href);
  const cjs = require('@tier0/sdk-v2');
  globalThis[runtimeKey] = {
    appId: process.env.TIER0_STREAM_MESSAGES_FIXTURE_APP_ID,
    request(path, body, { signal }) {
      return fetch(new URL(path, process.env.TIER0_STREAM_MESSAGES_FIXTURE_URL), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      });
    },
  };
  for (const [format, sdk] of [['ESM', esm], ['CJS', cjs]]) {
    const client = sdk.createClient();
    const errors = [];
    const off = client.streams.messages.onError(error => errors.push(error));
    let subscription;
    let timer;
    try {
      assert.equal(typeof client.uns.recordFind, 'function');
      assert.equal(client.controls, undefined);
      const message = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${format} packaged native publish timeout`)), 5000);
        subscription = client.streams.messages.use({ topic: process.env.TIER0_STREAM_MESSAGES_FIXTURE_TOPIC })
          .subscribe(resolve);
      });
      const handle = await subscription;
      subscription = handle;
      await client.streams.messages.use({ topic: process.env.TIER0_STREAM_MESSAGES_FIXTURE_TOPIC }).publish({ format });
      assert.deepEqual((await message).payload, { format });
      assert.deepEqual(errors, []);
      console.log(`PASS: installed ${format} SDK native TLS NATS delivery and disposal`);
    } finally {
      clearTimeout(timer);
      try { await (await subscription)?.dispose(); } finally { off(); await client.dispose(); }
    }
  }
  if (process.env.TIER0_STREAM_MESSAGES_FIXTURE_CONTROL_URL) {
    let stats;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(new URL('/__fixture/stats', process.env.TIER0_STREAM_MESSAGES_FIXTURE_CONTROL_URL), { signal: AbortSignal.timeout(3000) });
      assert.equal(response.ok, true);
      stats = await response.json();
      if (!stats.connections && !stats.subscriptions) break;
      await delay(20);
    }
    assert.equal(stats.connections, 0);
    assert.equal(stats.subscriptions, 0);
    console.log('PASS: native broker reports zero packaged-client connections/subscriptions after disposal');
  }
  // Bundle an actual public import with browser resolution, including lazy NATS
  // chunks. Resolution is rooted in the installed npm artifact.
  const entry = join(runtime, 'browser.mjs');
  await writeFile(entry, "export { createClient } from '@tier0/sdk-v2';\n");
  const result = await build({ absWorkingDir: runtime, entryPoints: [entry], bundle: true,
    splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
    outdir: join(runtime, 'browser-build'), write: false, metafile: true, logLevel: 'silent' });
  assert.ok(Object.keys(result.metafile.inputs).some(name => name.includes('@nats-io/nats-core')));
  const outputs = new Set(Object.keys(result.metafile.outputs));
  for (const output of Object.values(result.metafile.outputs)) for (const dependency of output.imports) {
    assert.equal(dependency.external, undefined, `External browser dependency: ${dependency.path}`);
    assert.ok(outputs.has(dependency.path), `Unbundled browser dependency: ${dependency.path}`);
  }
  assert.equal(result.warnings.length, 0);
  console.log('PASS: installed browser SDK bundles complete native NATS dependency closure (build check, not browser E2E)');
} finally {
  delete globalThis[runtimeKey];
  await rm(directory, { recursive: true, force: true });
}
