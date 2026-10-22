import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = resolve(process.argv[2] ?? root);
const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
mkdirSync(resolve(root, '.tmp'), { recursive: true });
const scratch = mkdtempSync(resolve(root, '.tmp/skill-examples-'));
const files = [];
const sources = [];
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.md')) {
      const content = readFileSync(path, 'utf8');
      for (const match of content.matchAll(/^```(?:ts|typescript)\r?\n([\s\S]*?)^```/gm)) {
        const line = content.slice(0, match.index).split('\n').length;
        const name = `example-${files.length + 1}.mts`;
        const target = resolve(scratch, name);
        writeFileSync(target, match[1]);
        files.push(target);
        sources.push(`${name}: ${relative(packageRoot, path)}:${line}`);
      }
    }
  }
}
// Sub-Skills are nested under the root Skill, so collecting the root covers every Skill once.
collect(resolve(packageRoot, 'skills'));
if (!files.length) throw new Error('No typed Skill examples found');
const paths = {};
for (const [key, value] of Object.entries(pkg.exports)) {
  if (typeof value === 'string') continue;
  const types = resolve(packageRoot, value.import.types);
  const source = resolve(packageRoot, value.import.types.replace('./dist/esm/', './src/').replace(/\.d\.ts$/, '.ts'));
  paths[pkg.name + (key === '.' ? '' : key.slice(1))] = [existsSync(source) ? source : types];
}
writeFileSync(resolve(scratch, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, skipLibCheck: true, noEmit: true, paths }, files,
}, null, 2));
try {
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(scratch, 'tsconfig.json')],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
} catch (error) {
  console.error(sources.join('\n'));
  console.error(error.stdout?.toString() ?? error.message);
  process.exit(1);
}
console.log(`Type-checked ${files.length} Skill examples against ${packageRoot === resolve(root) ? 'source' : 'packed declarations'}.`);
