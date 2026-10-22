import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse the behavioral assertions, but load code and Skills only from the tarball.
const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = resolve(process.argv[2]);
const installed = resolve(consumer, 'node_modules/@tier0/sdk-v2');
if (!existsSync(resolve(installed, 'dist/esm/index.js'))) throw new Error('Install the tarball before testing');
cpSync(resolve(root, 'tests'), resolve(consumer, 'tests'), { recursive: true });
cpSync(resolve(root, 'contracts'), resolve(consumer, 'contracts'), { recursive: true });
cpSync(resolve(installed, 'skills'), resolve(consumer, 'skills'), { recursive: true });
let testFiles = 0;
function rewrite(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) { rewrite(file); continue; }
    if (!entry.name.endsWith('.test.ts')) continue;
    testFiles++;
    let imports = 0;
    const source = readFileSync(file, 'utf8').replace(/(['"])((?:\.\.\/)+)src\/([^'"\n]+)\1/g, (_, quote, _parents, subpath) => {
      const target = resolve(installed, 'dist/esm', subpath);
      if (!existsSync(target)) throw new Error(`Missing packed implementation: ${subpath}`);
      imports++;
      return quote + relative(dirname(file), target).replaceAll('\\', '/') + quote;
    });
    if (!imports || /(?:\.\.\/)+src\//.test(source)) throw new Error(`Test still depends on source: ${file}`);
    writeFileSync(file, source);
  }
}
rewrite(resolve(consumer, 'tests'));
const config = {
  root: consumer,
  test: {
    include: ['tests/**/*.test.ts'],
    server: { deps: { inline: ['@tier0/sdk-v2'] } },
    reporters: ['default', 'json'],
    outputFile: { json: resolve(consumer, 'installed-tests.json') },
  },
};
writeFileSync(resolve(consumer, 'vitest.config.mjs'), `export default ${JSON.stringify(config)};\n`);
execFileSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(consumer, 'vitest.config.mjs')], { cwd: consumer, stdio: 'inherit' });
const report = JSON.parse(readFileSync(resolve(consumer, 'installed-tests.json'), 'utf8'));
if (!report.success || report.testResults.length !== testFiles || report.numPendingTests || report.numTodoTests) throw new Error('Packed test suite incomplete');
console.log(`Installed tarball: ${report.numPassedTests} tests passed in ${testFiles} files (no source imports).`);
