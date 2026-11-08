// Run only against a controlled gateway and two temporary App keys issued for
// distinct Apps in the same workspace. Key material is read from private files.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const [host, firstPath, secondPath, firstApp, secondApp, modulePath] = process.argv.slice(2);
if (!host || !firstPath || !secondPath || !firstApp || !secondApp || firstApp === secondApp || !modulePath) {
  throw new Error('Expected host, two private key files, two distinct App IDs and the SDK data module path.');
}
const keys = await Promise.all([firstPath, secondPath].map(async (path) => (await readFile(path, 'utf8')).trim()));
if (keys.some(key => !key) || keys[0] === keys[1]) throw new Error('Expected distinct nonempty credentials.');

async function identity(key) {
  const response = await fetch(new URL('/openapi/v2/auth/whoami', host), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: '{}',
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  if (!response.ok || payload?.code !== 200 || !payload.data) throw new Error('whoami did not confirm the credential.');
  return payload.data;
}
const [first, second] = await Promise.all(keys.map(identity));
for (const field of ['workspaceID', 'userID', 'keyType']) {
  if (first[field] == null || first[field] !== second[field]) throw new Error(`Expected equal ${field} for this experiment.`);
}
if ('appId' in first || 'appID' in first || 'appId' in second || 'appID' in second) {
  throw new Error('whoami now exposes an App identity; revisit this boundary.');
}

const { createDataClient } = await import(pathToFileURL(modulePath).href);
let providerCalls = 0;
let sends = 0;
let rejected = false;
try {
  createDataClient({ apiHost: host, apiKey: keys[0], apiKeyProvider: async () => keys[providerCalls++ % 2],
    fetch: async () => { sends++; throw new Error('Unexpected data request'); } });
} catch (error) {
  rejected = error instanceof TypeError && error.message.includes('apiKeyProvider is not supported');
}
if (!rejected || providerCalls || sends) throw new Error('Data provider boundary did not fail before resolution and dispatch.');
console.log(JSON.stringify({ gatewayWhoami: 'both-valid-same-user-workspace-type', distinctApps: true,
  appIdentityInWhoami: false, dataProviderRejected: true, providerCalls, sends, credentialsIncluded: false }));
