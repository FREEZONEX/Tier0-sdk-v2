import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection, type DataClientConfig, type SubscriptionEvent } from '../../src/data/index.js';

const orders = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ code: z.string() }) });
const requests: { server: string; path: string; key?: string; auth?: string; cursor?: string }[] = [];
let failFirstA = false;
let revokedA = false;
let reconnectCount = 0;
let reconnectMode = false;
const servers: Server[] = [];
const hosts: string[] = [];
function startFixture(serverName: string): Promise<string> {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    const path = req.url!.split('?')[0];
    const key = req.headers['x-api-key'] as string | undefined;
    requests.push({ server: serverName, path, key, auth: req.headers.authorization, cursor: req.headers['last-event-id'] as string | undefined });
    const send = (status: number, data: unknown, error?: object) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: status, msg: '', requestId: 'fixture', data, ...(error ? { error } : {}) }));
    };
    if (key !== 'user-a' && key !== 'user-b') return send(401, null);
    if (revokedA && key === 'user-a') return send(403, null, { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } });
    if (path === '/openapi/v2/uns/app/collections/ensure') {
      return send(200, { appId: key, results: [{ alias: 'orders', collectionId: `${key}-orders`, revision: 1, status: 'unchanged' }] });
    }
    if (path === `/openapi/v2/uns/collections/${key}-orders/records:count`) {
      if (key === 'user-a' && failFirstA) {
        failFirstA = false;
        return send(503, null, { code: 'TEMPORARILY_UNAVAILABLE', details: [], execution: 'notStarted', retry: { safe: true, afterMs: 0 } });
      }
      return send(200, { count: key === 'user-a' ? 11 : 22, capped: false });
    }
    if (path === '/openapi/v2/uns/records:subscribe') {
      const url = new URL(req.url!, 'http://fixture');
      if (url.searchParams.get('collectionIds') !== `${key}-orders`) return send(403, null);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const revision = reconnectMode ? ++reconnectCount : 1;
      const eventId = reconnectMode ? `${key}-${revision}` : key;
      const event = { eventId, collectionId: `${key}-orders`, recordId: 'r', revision, change: 'record', occurredAt: 1000, restricted: false };
      res.end(`id: ${eventId}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
      return;
    }
    return send(403, null, { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } });
  });
  servers.push(server);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}
beforeAll(async () => { hosts.push(await startFixture('A'), await startFixture('B')); });
afterAll(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
afterEach(() => { vi.unstubAllEnvs(); requests.length = 0; failFirstA = false; revokedA = false; reconnectCount = 0; reconnectMode = false; });
async function firstEvent(events: AsyncIterable<SubscriptionEvent>) {
  for await (const event of events) return event;
  throw new Error('missing event');
}

describe('Data client stable credential boundary over HTTP', () => {
  it('rejects an A-then-B getter before preflight or dispatch to the actual HTTP server', async () => {
    let calls = 0;
    const getter = vi.fn(() => ++calls === 1 ? 'user-a' : 'user-b');
    let failure: unknown;
    try {
      const client = createDataClient({ apiHost: hosts[0], getApiKey: getter } as unknown as DataClientConfig);
      // On the old code preflight selects A and this HTTP request is sent as B.
      await client.collection({ collectionId: 'user-b-orders' }).countDocuments();
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(TypeError);
    expect(String(failure)).toContain('getApiKey is not supported');
    expect(getter).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('rejects async and explicit undefined providers before evaluating or sending credentials', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = vi.fn(async () => 'user-b');
    expect(() => createDataClient({ apiHost: hosts[0], apiKeyProvider: provider, fetch } as unknown as DataClientConfig)).toThrow('apiKeyProvider is not supported');
    expect(() => createDataClient({ apiHost: hosts[0], getApiKey: undefined } as DataClientConfig)).toThrow('getApiKey is not supported');
    expect(() => createDataClient({ apiHost: hosts[0], apiKeyProvider: undefined } as DataClientConfig)).toThrow('apiKeyProvider is not supported');
    expect(provider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('pins each environment identity and host across interleaved bootstrap, retry and SSE', async () => {
    vi.stubEnv('TIER0_API_KEY', 'user-a');
    vi.stubEnv('TIER0_API_HOST', hosts[0]);
    const a = createDataClient({ collections: [orders] });
    vi.stubEnv('TIER0_API_KEY', 'user-b');
    vi.stubEnv('TIER0_API_HOST', hosts[1]);
    const b = createDataClient({ collections: [orders] });
    failFirstA = true;
    const [countA, countB] = await Promise.all([
      a.collection(orders).countDocuments(), b.collection(orders).countDocuments(),
    ]);
    expect(countA.count).toBe(11);
    expect(countB.count).toBe(22);
    const [eventA, eventB] = await Promise.all([firstEvent(a.subscribe()), firstEvent(b.subscribe())]);
    expect(eventA).toMatchObject({ type: 'change', eventId: 'user-a', collectionId: 'user-a-orders' });
    expect(eventB).toMatchObject({ type: 'change', eventId: 'user-b', collectionId: 'user-b-orders' });
    expect(requests.filter(r => r.server === 'A').map(r => [r.path, r.key, r.auth])).toEqual([
      ['/openapi/v2/uns/app/collections/ensure', 'user-a', undefined],
      ['/openapi/v2/uns/collections/user-a-orders/records:count', 'user-a', undefined],
      ['/openapi/v2/uns/collections/user-a-orders/records:count', 'user-a', undefined],
      ['/openapi/v2/uns/records:subscribe', 'user-a', undefined],
    ]);
    expect(requests.filter(r => r.server === 'B').map(r => [r.path, r.key, r.auth])).toEqual([
      ['/openapi/v2/uns/app/collections/ensure', 'user-b', undefined],
      ['/openapi/v2/uns/collections/user-b-orders/records:count', 'user-b', undefined],
      ['/openapi/v2/uns/records:subscribe', 'user-b', undefined],
    ]);
    revokedA = true;
    await expect(a.collection(orders).countDocuments()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(requests.at(-1)).toMatchObject({ server: 'A', key: 'user-a' });
  });

  it('uses a distinct explicitly keyed Data client for each trusted principal', async () => {
    vi.stubEnv('TIER0_API_KEY', 'unrelated-process-key');
    vi.stubEnv('TIER0_API_HOST', hosts[1]);
    const forPrincipal = (apiHost: string, apiKey: string) => createDataClient({ apiHost, apiKey, collections: [orders] });
    const a = forPrincipal(hosts[0], 'user-a');
    const b = forPrincipal(hosts[1], 'user-b');
    failFirstA = true;
    const [countA, countB] = await Promise.all([
      a.collection(orders).countDocuments(), b.collection(orders).countDocuments(),
    ]);
    expect([countA.count, countB.count]).toEqual([11, 22]);
    const [eventA, eventB] = await Promise.all([firstEvent(a.subscribe()), firstEvent(b.subscribe())]);
    expect(eventA).toMatchObject({ collectionId: 'user-a-orders', eventId: 'user-a' });
    expect(eventB).toMatchObject({ collectionId: 'user-b-orders', eventId: 'user-b' });
    expect(requests.filter(r => r.server === 'A')).toHaveLength(4);
    expect(requests.filter(r => r.server === 'B')).toHaveLength(3);
    expect(requests.every(r => r.auth === undefined && r.key === (r.server === 'A' ? 'user-a' : 'user-b'))).toBe(true);
  });

  it('does not adopt a later environment key or host after being created unconfigured', async () => {
    vi.stubEnv('TIER0_API_KEY', '');
    vi.stubEnv('TIER0_API_HOST', '');
    const data = createDataClient({ collections: [orders] });
    vi.stubEnv('TIER0_API_KEY', 'user-b');
    vi.stubEnv('TIER0_API_HOST', hosts[1]);
    await expect(data.collection(orders).countDocuments()).rejects.toMatchObject({ code: 'DATA_NOT_CONFIGURED' });
    expect(requests).toEqual([]);
  });

  it('does not adopt an environment key when an explicit undefined key was provided', async () => {
    vi.stubEnv('TIER0_API_KEY', 'user-a');
    const data = createDataClient({ apiHost: hosts[0], apiKey: undefined, collections: [orders] });
    vi.stubEnv('TIER0_API_KEY', 'user-b');
    await expect(data.collection(orders).countDocuments()).rejects.toMatchObject({ code: 'DATA_NOT_CONFIGURED' });
    expect(requests).toEqual([]);
  });

  it('reconnects SSE with the original identity and cursor after the environment changes', async () => {
    vi.stubEnv('TIER0_API_KEY', 'user-a');
    vi.stubEnv('TIER0_API_HOST', hosts[0]);
    const data = createDataClient({ collections: [orders] });
    reconnectMode = true;
    const iterator = data.subscribe()[Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).value).toMatchObject({ eventId: 'user-a-1', collectionId: 'user-a-orders' });
      vi.stubEnv('TIER0_API_KEY', 'user-b');
      vi.stubEnv('TIER0_API_HOST', hosts[1]);
      expect((await iterator.next()).value).toMatchObject({ eventId: 'user-a-2', collectionId: 'user-a-orders' });
      expect(requests.filter(r => r.path.endsWith('/records:subscribe'))).toMatchObject([
        { server: 'A', key: 'user-a', cursor: undefined },
        { server: 'A', key: 'user-a', cursor: 'user-a-1' },
      ]);
    } finally { await iterator.return?.(); }
  });

  it('snapshots a host getter once and keeps an explicit static key', async () => {
    vi.stubEnv('TIER0_API_KEY', 'user-b');
    let target = hosts[0];
    const getApiHost = vi.fn(() => target);
    const config = { collections: [orders], apiKey: 'user-a', getApiHost };
    const data = createDataClient(config);
    target = hosts[1];
    config.apiKey = 'user-b';
    expect((await data.collection(orders).countDocuments()).count).toBe(11);
    expect(getApiHost).toHaveBeenCalledOnce();
    expect(requests.every(r => r.server === 'A' && r.key === 'user-a')).toBe(true);
  });
});
