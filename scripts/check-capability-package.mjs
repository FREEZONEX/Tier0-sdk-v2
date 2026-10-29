import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise the installed package, including the scaffold's createRequire path.
const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = resolve(process.argv[2]);
const require = createRequire(resolve(consumer, 'package.json'));
const pkg = require('@tier0/sdk-v2/package.json');
const installed = resolve(consumer, 'node_modules/@tier0/sdk-v2');
const vectors = JSON.parse(readFileSync(resolve(root, 'contracts/capability-discovery/vectors.json'), 'utf8'));
let response;
let requests = 0;
let invalidRequest = false;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  requests++;
  invalidRequest ||= req.url !== '/openapi/v2/capabilities/discover' || req.method !== 'POST' || body !== '{}' ||
    req.headers.authorization !== 'Bearer installed-sdk-fixture' || req.headers['x-api-key'] !== 'installed-sdk-fixture' ||
    req.headers['x-tier0-app-data-subject'] !== undefined || req.headers['idempotency-key'] !== undefined;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const apiHost = `http://127.0.0.1:${server.address().port}`;
  const modules = {
    esm: await import(pathToFileURL(resolve(installed, pkg.exports['.'].import.default)).href),
    cjs: require('@tier0/sdk-v2'),
  };
  for (const [mode, sdk] of Object.entries(modules)) {
    const client = sdk.createClient({ apiHost, apiKey: 'installed-sdk-fixture', unsV2AppDataSubject: 'fixture.data.subject' });
    for (const vector of vectors) {
      response = vector.response;
      const before = requests;
      if (vector.valid) {
        const expected = vector.expectedCapabilities === undefined ? response : { ...response, capabilities: vector.expectedCapabilities };
        assert.deepEqual(await client.capabilities.discover(), expected, `${mode}: ${vector.name}`);
      } else {
        await assert.rejects(client.capabilities.discover(), error => error instanceof sdk.CapabilityError &&
          error.errorCode === (vector.expectedErrorCode ?? 'CAPABILITY_PROTOCOL_ERROR') && error.retryable === false,
        `${mode}: ${vector.name}`);
      }
      assert.equal(requests - before, 1, `${mode}: discovery must not retry`);
    }
  }
  assert.equal(invalidRequest, false, 'Discovery must send only the authenticated empty request, without App data delegation');
  console.log(`Installed ${pkg.name}@${pkg.version}: ${vectors.length} shared vectors passed via ESM/CJS and ${requests} local HTTP requests. Not deployed App acceptance.`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
