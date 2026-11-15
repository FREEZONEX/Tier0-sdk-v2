import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Compare an isolated synthetic App transaction with a pre-change codec bundle.
// No HTTP or database calls; output hashes verify the complete encoded request.
const [fixturePath, baselinePath, outputPath] = process.argv.slice(2);
assert.ok(fixturePath && baselinePath && outputPath,
  'Usage: node scripts/benchmark-codec.mjs <synthetic-fixture.json> <baseline-codec.mjs> <output.json>');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(fixture.synthetic, true);
const temporary = new URL(`.codec-benchmark-${process.pid}.mjs`, import.meta.url);
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/uns-v2/codec.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(temporary, compiled.outputFiles[0].text);
try {
  const baseline = await import(pathToFileURL(resolve(baselinePath)).href);
  const current = await import(temporary.href);
  // Resolve the generated contract name, rather than silently benchmarking an unknown schema.
  const contractBundle = await build({ stdin: { contents: "export { UNS_V2_OPERATIONS } from './src/uns-v2/generated.ts';",
    resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
  const { UNS_V2_OPERATIONS } = await import(`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString('base64')}`);
  const requestSchema = UNS_V2_OPERATIONS.recordTransactionExecute.request;
  assert.ok(requestSchema, 'Missing record transaction request schema');
  const expected = baseline.encodeUnsV2JSON(fixture.request, requestSchema);
  assert.equal(current.encodeUnsV2JSON(fixture.request, requestSchema), expected);
  assert.deepEqual(current.decodeUnsV2JSON(expected, requestSchema), baseline.decodeUnsV2JSON(expected, requestSchema));
  const measurements = [];
  for (let run = 0; run < 5; run++) {
    // Alternate order to avoid consistently favoring one implementation.
    const modes = run % 2 ? [['current', current], ['baseline', baseline]] : [['baseline', baseline], ['current', current]];
    for (const [mode, codec] of modes) {
      const started = performance.now();
      const wire = codec.encodeUnsV2JSON(fixture.request, requestSchema);
      const encodeMs = performance.now() - started;
      assert.equal(wire, expected);
      const decodeStarted = performance.now();
      const decoded = codec.decodeUnsV2JSON(wire, requestSchema);
      const decodeMs = performance.now() - decodeStarted;
      assert.equal(decoded.items.length, fixture.request.items.length);
      measurements.push({ run: run + 1, mode, encodeMs, decodeMs });
    }
  }
  const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const medians = Object.fromEntries(['baseline', 'current'].map(mode => [mode, {
    encodeMs: median(measurements.filter(x => x.mode === mode).map(x => x.encodeMs)),
    decodeMs: median(measurements.filter(x => x.mode === mode).map(x => x.decodeMs)),
  }]));
  const report = { synthetic: true, scope: 'Codec CPU only; excludes validation, HTTP and PostgreSQL.',
    node: process.version, steps: fixture.request.items.length, requestSchema,
    bytes: Buffer.byteLength(expected), wireSHA256: createHash('sha256').update(expected).digest('hex'),
    measurements, medians, reductionPercent: {
      encode: 100 * (1 - medians.current.encodeMs / medians.baseline.encodeMs),
      decode: 100 * (1 - medians.current.decodeMs / medians.baseline.decodeMs),
    } };
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await unlink(temporary); }
