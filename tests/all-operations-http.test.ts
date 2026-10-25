import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, createUnsV2Client, UNS_V2_OPERATIONS, UNS_V2_CONTRACT_PROVENANCE, type UnsV2OperationName } from '../src/index.js';
import { HttpClient } from '../src/openapi/client.js';
import { OPENAPI_OPERATIONS } from '../src/openapi/api.generated.js';

// Exhaustive transport smoke coverage, not a simulation of backend business rules.
// Expected routes come from the frozen upstream inputs, separately from SDK metadata.
const contract = JSON.parse(readFileSync(new URL('../contracts/uns-v2/contract.json', import.meta.url), 'utf8'));
const v1 = JSON.parse(readFileSync(new URL('../contracts/openapi-v1.normalized.json', import.meta.url), 'utf8'));
const observed: { method?: string; path?: string; key?: string; body: unknown }[] = [];
let apiHost: string;
let responseMode = 'envelope';
const server = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  observed.push({ method: req.method, path: req.url, key: req.headers['x-api-key'] as string, body: text ? JSON.parse(text) : undefined });
  res.setHeader('content-type', 'application/json');
  if (req.url === '/storage-fixture') { res.end('packed-download-fixture'); return; }
  if (req.url?.startsWith('/openapi/v1/assets/files/url')) {
    res.end(JSON.stringify({ code: 200, data: { fileUrl: `${apiHost}/storage-fixture` } })); return;
  }
  res.end(JSON.stringify(responseMode === 'direct' ? { messageId: 'fixture' } : { code: 200, msg: '', requestId: 'fixture', data: {} }));
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const config = () => ({ apiHost, apiKey: 'transport-fixture-key', transportTimeoutMs: 2000 });

describe('all UNS v2 public operations reach their upstream route', () => {
  for (const [name, operation] of Object.entries(UNS_V2_OPERATIONS)) {
    if (operation.method !== 'POST') continue;
    it(name, async () => {
      observed.length = 0;
      responseMode = 'envelope';
      const upstream = contract.operations.find((item: { name: string }) => item.name === name);
      expect(upstream).toBeDefined();
      const body = { ...upstream.example };
      let expectedPath = `/openapi/v2${upstream.suffix}`;
      for (const key of operation.pathParams) {
        body[key] = `fixture-${key}`;
        expectedPath = expectedPath.replace(`:${key}`, body[key]);
      }
      const client = createUnsV2Client(() => new HttpClient(config()), config());
      const result = await (client[name as UnsV2OperationName] as (body: object) => Promise<unknown>)(body);
      expect(result).toMatchObject({ code: 200, requestId: 'fixture' });
      expect(observed).toEqual([{ method: 'POST', path: expectedPath, key: 'transport-fixture-key', body }]);
    });
  }
});

type Method = (...args: any[]) => Promise<any>;
function flatten(object: object, prefix = ''): Record<string, Method> {
  const result: Record<string, Method> = {};
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? prefix + key[0].toUpperCase() + key.slice(1) : key;
    if (typeof value === 'function') result[name] = value as Method;
    else Object.assign(result, flatten(value, name));
  }
  return result;
}

describe('all 51 v1 generated methods reach their upstream route', () => {
  it('matches the complete public method inventory', () => {
    expect(Object.keys(flatten(createClient(config()).api)).sort()).toEqual(Object.keys(OPENAPI_OPERATIONS).sort());
    expect(Object.keys(OPENAPI_OPERATIONS)).toHaveLength(51);
    expect(Object.keys(UNS_V2_OPERATIONS)).toHaveLength(UNS_V2_CONTRACT_PROVENANCE.publicOperationCount);
  });
  for (const [name, operation] of Object.entries(OPENAPI_OPERATIONS)) {
    it(name, async () => {
      observed.length = 0;
      responseMode = operation.mode;
      const upstream = v1.paths[operation.path]?.[operation.method.toLowerCase()];
      expect(upstream).toBeDefined();
      const params = Object.fromEntries(operation.pathParams.map(key => [key, `fixture-${key}`]));
      let path = operation.path as string;
      for (const [key, value] of Object.entries(params)) path = path.replace(`{${key}}`, value);
      const method = flatten(createClient(config()).api)[name];
      const request = operation.method === 'GET' ? { filePath: 'fixture.txt' } : {};
      const args = operation.pathParams.length ? [params, request] : [request];
      const result = await method(...args);
      if (operation.method === 'GET') path += '?filePath=fixture.txt';
      if (operation.mode === 'download') {
        expect(await result.text()).toBe('packed-download-fixture');
        path = path.replace('/files/download', '/files/url');
        expect(observed[1]).toMatchObject({ path: '/storage-fixture', key: undefined });
      }
      expect(observed).toHaveLength(operation.mode === 'download' ? 2 : 1);
      expect(observed[0]).toMatchObject({ method: operation.method, path, key: 'transport-fixture-key' });
      if (upstream.requestBody) expect(observed[0].body).toEqual(name === 'notificationsSend' ? { channels: ['web', 'mobile'] } : {});
    });
  }
});
