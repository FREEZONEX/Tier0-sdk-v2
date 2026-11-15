import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { z } from 'zod';

// Uses an already generated synthetic transaction; no database or platform calls.
const [fixturePath, outputPath] = process.argv.slice(2);
assert.ok(fixturePath && outputPath, 'Usage: node scripts/benchmark-transaction-validation.mjs <fixture.json> <output.json>');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(fixture.synthetic, true);
const entry = new URL('../src/data/schema.ts', import.meta.url);
const temporary = new URL(`.validation-benchmark-${process.pid}.mjs`, import.meta.url);
const compiled = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false });
await writeFile(temporary, compiled.outputFiles[0].text);
try {
  const module = await import(temporary.href);
  const definitions = new Map(fixture.collections.map(collection => [collection.alias, {
    alias: collection.alias, name: collection.name, schema: z.fromJSONSchema(collection.recordSchema), indexes: [],
  }]));
  const rows = fixture.request.items.filter(item => item.data).map(item => ({
    definition: definitions.get(item.collectionId), data: item.data,
    bound: (item.bindings ?? []).flatMap(binding => binding.path.startsWith('data.') ? [binding.path.slice(5).split('.')[0]] : []),
  }));
  for (const row of rows) assert.ok(row.definition);
  const results = [];
  const modes = ['single', ...(module.createStepDataValidator ? ['request'] : [])];
  // Warm the declaration cache, just as collection ensure does before a write.
  for (const definition of definitions.values()) module.compileCollection(definition);
  for (let run = 0; run < 3; run++) {
    for (const mode of modes) {
      const validate = mode === 'request' ? module.createStepDataValidator() : module.validateStepData;
      const started = performance.now();
      let fields = 0;
      for (const row of rows) fields += Object.keys(validate(row.definition, row.data, row.bound)).length;
      results.push({ mode, run: run + 1, milliseconds: performance.now() - started, fields });
    }
  }
  assert.equal(new Set(results.map(result => result.fields)).size, 1);
  let verifiedOutputSHA256;
  if (module.createStepDataValidator) {
    const single = createHash('sha256'), request = createHash('sha256'), validate = module.createStepDataValidator();
    // Compare complete values outside the timed section, not just row/field counts.
    for (const row of rows) {
      single.update(JSON.stringify(module.validateStepData(row.definition, row.data, row.bound)) + '\n');
      request.update(JSON.stringify(validate(row.definition, row.data, row.bound)) + '\n');
    }
    verifiedOutputSHA256 = single.digest('hex');
    assert.equal(request.digest('hex'), verifiedOutputSHA256);
  }
  const result = { synthetic: true, scope: 'Only SDK validation; Zod declarations reconstructed from the fixture compiled schemas. No HTTP, planning or database time.',
    records: rows.length, collections: definitions.size, results, verifiedOutputSHA256 };
  await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await unlink(temporary); }
