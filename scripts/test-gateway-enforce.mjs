import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const backend = process.argv[2];
if (!backend) throw new Error('Usage: npm run test:gateway-enforce -- /path/to/Tier0-Backend');
const gateway = resolve(backend);
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: gateway, encoding: 'utf8' });
if (sha.status !== 0) throw new Error('Backend must be a git checkout');
console.log(`Backend under test: ${sha.stdout.trim()}`);
const temp = mkdtempSync(resolve(tmpdir(), 'sdk-v2-gateway-enforce-'));
try {
  const overlay = resolve(temp, 'overlay.json');
  writeFileSync(overlay, JSON.stringify({ Replace: {
    [resolve(gateway, 'service/gwsvr/internal/handler/sdk_single_auth_contract_test.go')]:
      resolve(root, 'tests/gateway-enforce/single_auth_test.go'),
  } }));
  const result = spawnSync('go', ['test', '-p', '1', '-overlay', overlay,
    './service/gwsvr/internal/handler', '-run', '^TestSDKSingleAuthGatewayEnforce$', '-count=1', '-v'], {
    cwd: gateway, stdio: 'inherit', env: { ...process.env, GOMAXPROCS: '2',
      TIER0_SDK_GATEWAY_TEST_ENTRY: resolve(root, 'dist/esm/index.js') },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
