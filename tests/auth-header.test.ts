import { expect, it, vi } from 'vitest';
import { HttpClient } from '../src/openapi/client.js';
import { CloudTransport } from '../src/cloud-transport.js';

it('sends exactly one API credential across generated, raw, stream and fallback transports', async () => {
  const calls: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect });
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });
  const client = new HttpClient({ apiHost: 'https://api.example', apiKey: 'sk-fixture', fetch });
  const cloud = new CloudTransport(() => client);
  await client.post('/openapi/v2/auth/whoami', {});
  await cloud.postText('/openapi/v2/uns/metadata:list', '{}');
  await cloud.getEventStream('/openapi/v2/uns/records:subscribe');
  await cloud.post('/openapi/v2/stream-requests/discover', {});
  expect(calls.map(call => call.url)).toEqual([
    'https://api.example/openapi/v2/auth/whoami',
    'https://api.example/openapi/v2/uns/metadata:list',
    'https://api.example/openapi/v2/uns/records:subscribe',
    'https://api.example/openapi/v2/stream-requests/discover',
  ]);
  for (const call of calls) {
    expect(call.headers.get('X-API-Key')).toBe('sk-fixture');
    expect(call.headers.has('Authorization')).toBe(false);
    expect(call.redirect).toBe('manual');
  }
});
