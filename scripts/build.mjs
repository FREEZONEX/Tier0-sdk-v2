import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
if (!dist.startsWith(resolve(root) + sep)) throw new Error('Invalid build output');
rmSync(dist, { recursive: true, force: true });
for (const format of ['esm', 'cjs']) {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', `tsconfig.${format}.json`], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  mkdirSync(resolve(dist, format), { recursive: true });
  writeFileSync(resolve(dist, format, 'package.json'), JSON.stringify({ type: format === 'esm' ? 'module' : 'commonjs' }) + '\n');
}
