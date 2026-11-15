import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { z } from 'zod';

// Full SDK transaction preparation with an isolated in-memory HTTP response.
// The supplied baseline must export createDataClient and defineCollection.
const [fixturePath, baselinePath, outputPath] = process.argv.slice(2);
assert.ok(fixturePath && baselinePath && outputPath,
  'Usage: node scripts/benchmark-transaction-wire.mjs <synthetic-fixture.json> <baseline-sdk.mjs> <output.json>');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(fixture.synthetic, true);
const temporary = new URL(`.transaction-wire-benchmark-${process.pid}.mjs`, import.meta.url);
const compiled = await build({ stdin: {
  contents: 'export { createDataClient } from "./src/data/client.ts"; export { defineCollection } from "./src/data/define.ts";',
  resolveDir: fileURLToPath(new URL('../', import.meta.url)),
}, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(temporary, compiled.outputFiles[0].text);
try {
  const baseline = await import(pathToFileURL(resolve(baselinePath)).href);
  const current = await import(temporary.href);
  const steps = fixture.request.items.map(({ collectionId, ...item }) => ({ ...item, collection: collectionId }));
  const options = { idempotencyKey: fixture.request.idempotencyKey, retryUnknown: false };
  assert.ok(options.idempotencyKey);
  const ok = data => Response.json({ code: 200, msg: 'ok', requestId: 'synthetic', data });
  function client(sdk) {
    const collections = fixture.collections.map(c => sdk.defineCollection({
      alias: c.alias, name: c.name, schema: z.fromJSONSchema(c.recordSchema), indexes: c.indexes,
    }));
    let sent, writes = 0;
    const data = sdk.createDataClient({ collections, apiHost: 'https://isolated.invalid', apiKey: 'fixture-only',
      logger: { info() {}, warn() {}, error() {} }, fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('/ensure')) return ok({ appId: 'synthetic', results: collections.map(c => ({
          alias: c.alias, collectionId: c.alias, status: 'unchanged', revision: 1,
        })) });
        if (path.endsWith('/context')) return ok({ appId: 'synthetic', limits: {
          transaction: { maxItems: 50_000, maxBodyBytes: 32 << 20, timeoutMs: 45_000 },
        } });
        assert.ok(path.endsWith('/records:transact'), `Unexpected request ${path}`);
        sent = init.body;
        writes++;
        return ok({ status: 'committed', results: [] });
      } });
    return { data, body: () => sent, writes: () => writes };
  }
  const clients = { baseline: client(baseline), current: client(current) };
  // Warm bootstrap, Zod and fixed codec metadata before the measured calls.
  for (const c of Object.values(clients)) await c.data.transact(steps, options);
  const expected = clients.baseline.body();
  assert.equal(clients.current.body(), expected);
  const measurements = [];
  for (let run = 0; run < 7; run++) {
    for (const mode of run % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      const c = clients[mode];
      const started = performance.now();
      await c.data.transact(steps, options);
      measurements.push({ run: run + 1, mode, milliseconds: performance.now() - started });
      assert.equal(c.body(), expected);
    }
  }
  for (const c of Object.values(clients)) assert.equal(c.writes(), 8);
  const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const medians = Object.fromEntries(Object.keys(clients).map(mode => [mode,
    median(measurements.filter(x => x.mode === mode).map(x => x.milliseconds)),
  ]));
  const report = { synthetic: true, node: process.version,
    scope: 'Warm SDK transaction preparation, validation and wire encoding with mocked HTTP. Excludes network, database and full result decoding.',
    steps: steps.length, collections: fixture.collections.length, bytes: Buffer.byteLength(expected),
    wireSHA256: createHash('sha256').update(expected).digest('hex'), measurements, medians,
    reductionPercent: 100 * (1 - medians.current / medians.baseline) };
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await unlink(temporary); }
