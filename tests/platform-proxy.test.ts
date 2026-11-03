import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createClient, createUnsV2Client } from '../src/index.js';
import { HttpClient } from '../src/openapi/client.js';
import { appCredentialRuntime, createDataClient, defineCollection, runAsApp, runWithRequestContext } from '../src/data/index.js';
import { platformIdentity, platformProxyMode } from '../src/platform-proxy.js';
import { getCurrentAppId } from '../src/runtime-context.js';
import { createVisitorTokenVerifier } from '../src/cloud-server.js';

// The node proxy (design 21.28) on a real socket: what the SDK puts on the wire.
const received: { url: string; method: string; body: string; headers: IncomingMessage['headers'] }[] = [];
let respond: (res: ServerResponse, req: IncomingMessage) => void;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({ url: req.url!, method: req.method!, body, headers: req.headers });
  respond(res, req);
});
let apiHost: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

const json = (res: ServerResponse, value: unknown, status = 200, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
};
const ok = (res: ServerResponse) => json(res, { code: 200, msg: 'ok', data: { userId: 'u' } });
/** An answer the proxy produced itself. */
const proxy = (res: ServerResponse, status: number, code: string, retryAfterMs?: number) =>
  json(res, { code, message: `proxy ${code}`, ...(retryAfterMs === undefined ? {} : { retry_after_ms: retryAfterMs }) }, status, { 'X-Tier0-Proxy': 'not-forwarded' });

const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const delegationToken = `${segment({ alg: 'EdDSA' })}.${segment({ typ: 'delegation' })}.sig`;
const envelope = (data: unknown = {}) => new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'r', data }), { status: 200, headers: { 'content-type': 'application/json' } });

function platformEnv(runtime: 'deployed' | 'preview' = 'deployed') {
  vi.stubEnv('TIER0_RUNTIME', runtime);
  vi.stubEnv('TIER0_API_KEY', undefined);
  vi.stubEnv('TIER0_API_HOST', apiHost);
  vi.stubEnv('TIER0_WORKSPACE_ID', '7205759403792793999');
  vi.stubEnv('TIER0_APP_ID', 'app_1');
  vi.stubEnv('TIER0_RELEASE', runtime === 'deployed' ? 'r1' : undefined);
  vi.stubEnv('TIER0_SESSION', runtime === 'preview' ? 's1' : undefined);
  vi.stubEnv('APP_ID', undefined);
}

beforeEach(() => {
  received.length = 0;
  respond = ok;
  platformEnv();
});
afterEach(() => vi.unstubAllEnvs());

describe('platform proxy mode (design 21.7)', () => {
  it('is on with TIER0_RUNTIME and no TIER0_API_KEY, and off otherwise', () => {
    expect(platformProxyMode()).toBe(true);
    vi.stubEnv('TIER0_API_KEY', 'sk-app-ws1_local');
    expect(platformProxyMode()).toBe(false);
    vi.stubEnv('TIER0_API_KEY', undefined);
    vi.stubEnv('TIER0_RUNTIME', undefined);
    expect(platformProxyMode()).toBe(false);
  });

  it('sends no credential header, marks the request with X-Tier0-SDK: 1, and does not follow redirects', async () => {
    const fetch = vi.fn(globalThis.fetch);
    await createClient({ fetch }).system.whoami();
    const { headers } = received[0];
    expect(headers['x-tier0-sdk']).toBe('1');
    for (const name of ['authorization', 'x-api-key', 'x-tier0-app-data-subject', 'proxy-authorization', 'cookie']) expect(headers[name]).toBeUndefined();
    expect(fetch.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('returns a redirect as an error instead of following it', async () => {
    respond = (res, req) => {
      if (req.url === '/elsewhere') return ok(res);
      res.writeHead(302, { location: '/elsewhere' });
      res.end();
    };
    await expect(createClient().system.whoami()).rejects.toMatchObject({ status: 302 });
    expect(received.map(r => r.url)).toEqual(['/openapi/v2/auth/whoami']);
  });

  it('marks UNS v2 and event-stream requests too, without the data subject', async () => {
    respond = (res, req) => {
      if (req.url!.includes('records:subscribe')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end();
        return;
      }
      json(res, { code: 200, msg: 'ok', requestId: 'r', data: { count: 0, capped: false } });
    };
    const subject = `${segment({ a: 1 })}.${segment({ b: 2 })}.sig`;
    const http = new HttpClient();
    const uns = createUnsV2Client(() => http, { unsV2AppDataSubject: subject });
    await uns.recordCount({ collectionId: 'c1' } as never);
    for await (const _event of uns.subscribeRecords({ collectionIds: ['c1'] })) break;
    expect(received.map(r => r.url.split('?')[0])).toEqual([
      '/openapi/v2/uns/collections/c1/records:count',
      '/openapi/v2/uns/records:subscribe',
    ]);
    for (const { headers } of received) {
      expect(headers['x-tier0-sdk']).toBe('1');
      expect(headers.authorization).toBeUndefined();
      expect(headers['x-api-key']).toBeUndefined();
      expect(headers['x-tier0-app-data-subject']).toBeUndefined();
    }
  });

  it('forwards the delegation as received on every interface, and not under runAsApp', async () => {
    const client = createClient();
    const request = new Request('http://app/x', { headers: { 'X-Tier0-Delegation': delegationToken } });
    await runWithRequestContext(request, () => client.system.whoami());
    await runWithRequestContext(request, () => runAsApp(() => client.system.whoami()));
    expect(received[0].headers['x-tier0-delegation']).toBe(delegationToken);
    expect(received[0].headers.authorization).toBeUndefined();
    expect(received[1].headers['x-tier0-delegation']).toBeUndefined();
  });

  it('keeps an explicit apiKey or getApiKey, without X-Tier0-SDK', async () => {
    await createClient({ apiKey: 'sk-explicit' }).system.whoami();
    await createClient({ getApiKey: () => 'sk-callback' }).system.whoami();
    expect(received.map(r => [r.headers.authorization, r.headers['x-api-key'], r.headers['x-tier0-sdk']])).toEqual([
      ['Bearer sk-explicit', 'sk-explicit', undefined],
      ['Bearer sk-callback', 'sk-callback', undefined],
    ]);
  });

  it('keeps TIER0_API_KEY for local development', async () => {
    vi.stubEnv('TIER0_RUNTIME', undefined);
    vi.stubEnv('TIER0_API_KEY', 'sk-app-ws1_local');
    await createClient().system.whoami();
    expect(received[0].headers.authorization).toBe('Bearer sk-app-ws1_local');
    expect(received[0].headers['x-api-key']).toBe('sk-app-ws1_local');
    expect(received[0].headers['x-tier0-sdk']).toBeUndefined();
  });

  it('defaults a bare TIER0_API_HOST to https and keeps the platform\'s http:// one', () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => envelope({ userId: 'u' }));
    vi.stubEnv('TIER0_API_HOST', 'http://api.sbx.internal:8080');
    void createClient({ fetch }).system.whoami();
    vi.stubEnv('TIER0_API_HOST', 'api.example');
    void createClient({ fetch }).system.whoami();
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual([
      'http://api.sbx.internal:8080/openapi/v2/auth/whoami',
      'https://api.example/openapi/v2/auth/whoami',
    ]);
  });
});

describe('retries of answers the proxy produced itself (design 21.28)', () => {
  it.each([[503, 'sbx_proxy_not_ready'], [429, 'sbx_proxy_limited']])('resends after a marked %i, waiting retry_after_ms', async (status, code) => {
    let calls = 0;
    respond = res => (++calls === 1 ? proxy(res, status, code, 120) : ok(res));
    const started = Date.now();
    await createClient().system.whoami();
    expect(received).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('gives up after 3 retries with the proxy code', async () => {
    respond = res => proxy(res, 503, 'sbx_proxy_not_ready', 1);
    await expect(createClient().system.whoami()).rejects.toMatchObject({ status: 503, errorCode: 'sbx_proxy_not_ready', msg: 'proxy sbx_proxy_not_ready' });
    expect(received).toHaveLength(4);
  });

  it('backs off without retry_after_ms', async () => {
    let calls = 0;
    respond = res => (++calls === 1 ? proxy(res, 503, 'sbx_proxy_not_ready') : ok(res));
    const started = Date.now();
    await createClient().system.whoami();
    expect(received).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it('never resends a platform 503: notifications/send goes once', async () => {
    respond = res => json(res, { errorCode: 'UNAVAILABLE', message: 'busy' }, 503);
    const body = { recipientUserId: '1', title: 'Task', content: 'Hello', type: 'business', idempotencyKey: 'intent-1' };
    await expect(createClient().notifications.send(body as never)).rejects.toMatchObject({ status: 503 });
    expect(received).toHaveLength(1);
  });

  it('never resends other proxy refusals', async () => {
    respond = res => proxy(res, 403, 'sbx_proxy_forbidden');
    await expect(createClient().system.whoami()).rejects.toMatchObject({ status: 403, errorCode: 'sbx_proxy_forbidden' });
    expect(received).toHaveLength(1);
  });

  it('does not retry with an explicit key', async () => {
    respond = res => proxy(res, 503, 'sbx_proxy_not_ready', 1);
    await expect(createClient({ apiKey: 'sk-explicit' }).system.whoami()).rejects.toMatchObject({ status: 503 });
    expect(received).toHaveLength(1);
  });

  it('stops waiting when the caller aborts', async () => {
    respond = res => proxy(res, 503, 'sbx_proxy_not_ready', 5_000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    await expect(createClient().api.system.whoami({ signal: controller.signal })).rejects.toMatchObject({ errorCode: 'SDK_ABORTED' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(received).toHaveLength(1);
  });

  it('reports a UNS v2 write the proxy kept refusing as not started, resent 3 times in all', async () => {
    respond = res => proxy(res, 503, 'sbx_proxy_not_ready', 1);
    const orders = defineCollection({ alias: 'orders', name: 'orders', collectionId: 'c1', schema: z.object({ title: z.string() }) } as never);
    const data = createDataClient({ collections: [orders], environment: 'deployed', logger: { info() {}, warn() {}, error() {} } as never });
    const error = await data.collection(orders).insertOne({ title: 'x' }).catch((e: unknown) => e);
    expect(received).toHaveLength(4);
    expect(error).toMatchObject({ code: 'sbx_proxy_not_ready', status: 503 });
    expect((error as { cause?: { execution?: string } }).cause?.execution).toBe('notStarted');
  });
});

describe('identity from the environment', () => {
  it('reads the App id from TIER0_APP_ID before APP_ID', () => {
    vi.stubEnv('APP_ID', '00000000-0000-4000-8000-000000000000');
    expect(getCurrentAppId()).toBe('app_1');
    vi.stubEnv('TIER0_APP_ID', undefined);
    expect(getCurrentAppId()).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('builds the identity of a deployment and of a Preview', () => {
    expect(platformIdentity()).toEqual({ ws: '7205759403792793999', app: 'app_1', runtime: 'deployed', release: 'r1' });
    platformEnv('preview');
    expect(platformIdentity()).toEqual({ ws: '7205759403792793999', app: 'app_1', runtime: 'preview', session: 's1' });
    vi.stubEnv('TIER0_SESSION', undefined);
    expect(platformIdentity()).toBeUndefined();
  });

  it('reports the runtime only in platform proxy mode', () => {
    expect(appCredentialRuntime()).toBe('deployed');
    platformEnv('preview');
    expect(appCredentialRuntime()).toBe('preview');
    vi.stubEnv('TIER0_API_KEY', 'sk-app-ws1_local');
    expect(appCredentialRuntime()).toBeUndefined();
  });

  it('checks the visitor token audience against TIER0_APP_ID', () => {
    vi.stubEnv('TIER0_APP_ID', undefined);
    expect(() => createVisitorTokenVerifier({ keys: { keys: () => new Map() } })('a.b.c')).toThrow('VISITOR_TOKEN_CONFIGURATION_INVALID');
    vi.stubEnv('TIER0_APP_ID', 'app_1');
    expect(() => createVisitorTokenVerifier({ keys: { keys: () => new Map() } })('a.b.c')).toThrow('VISITOR_TOKEN_INVALID');
  });
});

describe('the data layer in platform proxy mode', () => {
  const logger = { info() {}, warn() {}, error() {} } as never;

  it('needs no key, only TIER0_API_HOST', async () => {
    const orders = defineCollection({ alias: 'orders', name: 'orders', schema: z.object({ title: z.string() }) });
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => envelope());
    vi.stubEnv('TIER0_API_HOST', undefined);
    const data = createDataClient({ fetch, collections: [orders], environment: 'deployed', logger });
    await expect(data.collection(orders).countDocuments()).rejects.toMatchObject({ code: 'DATA_NOT_CONFIGURED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps ensure App-level when a request triggers it', async () => {
    const orders = defineCollection({ alias: 'orders', name: 'orders', schema: z.object({ title: z.string() }) });
    const seen: Record<string, string | null> = {};
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-tier0-sdk')).toBe('1');
      expect(headers.get('authorization')).toBeNull();
      if (String(url).includes('collections/ensure')) {
        seen.ensure = headers.get('x-tier0-delegation');
        return envelope({ appId: 'app_1', results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status: 'unchanged', ignored: [], warnings: [], indexStatus: [] }] });
      }
      seen.count = headers.get('x-tier0-delegation');
      return envelope({ count: 1, capped: false });
    });
    const data = createDataClient({ fetch: fetch as typeof globalThis.fetch, collections: [orders], environment: 'deployed', logger });
    await runWithRequestContext(new Headers({ 'X-Tier0-Delegation': delegationToken }), () => data.collection(orders).countDocuments());
    expect(seen).toEqual({ ensure: null, count: delegationToken });
  });

  describe('seeds in a platform Preview', () => {
    const seeded = defineCollection({ alias: 'orders', name: 'orders', schema: z.object({ title: z.string() }), seed: [{ _id: 's1', title: 'x' }] });
    function preview(status: string) {
      platformEnv('preview');
      const writes: (string | null)[] = [];
      const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('collections/ensure')) return envelope({ results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status, ignored: [], warnings: [], indexStatus: [] }] });
        if (String(url).includes('bulkWrite')) {
          writes.push(new Headers(init?.headers).get('x-tier0-delegation'));
          return envelope({ writeErrors: [] });
        }
        return envelope({ count: 1, capped: false });
      });
      const data = createDataClient({ fetch: fetch as typeof globalThis.fetch, collections: [seeded], environment: 'deployed', logger });
      return { data, writes };
    }

    it('wait for the first delegated request, and go once', async () => {
      const { data, writes } = preview('created');
      await runAsApp(() => data.ensure());
      expect(writes).toEqual([]);
      await runWithRequestContext(new Headers({ 'X-Tier0-Delegation': delegationToken }), () => data.collection(seeded).countDocuments());
      await runWithRequestContext(new Headers({ 'X-Tier0-Delegation': delegationToken }), () => data.collection(seeded).countDocuments());
      expect(writes).toEqual([delegationToken]);
    });

    it('are not written for an existing collection', async () => {
      const { data, writes } = preview('unchanged');
      await runWithRequestContext(new Headers({ 'X-Tier0-Delegation': delegationToken }), () => data.collection(seeded).countDocuments());
      expect(writes).toEqual([]);
    });
  });
});

it('ships no command that could print a credential', () => {
  expect(JSON.parse(readFileSync('package.json', 'utf8')).bin).toBeUndefined();
});
