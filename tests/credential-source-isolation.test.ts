import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, createSourceClient, createStreamClient, createUnsDataClient } from '../src/index.js';
import { HttpClient } from '../src/openapi/client.js';
import { CloudTransport } from '../src/cloud-transport.js';
import { createDataTransport } from '../src/data/call.js';

const received: { path: string; key?: string; auth?: string; storage: boolean }[] = [];
let origin = '';
const fixture = createServer(async (req, res) => {
  for await (const _chunk of req) { /* drain body */ }
  const path = req.url!.split('?')[0];
  const storage = path.startsWith('/storage/');
  const key = req.headers['x-api-key'] as string | undefined;
  received.push({ path, key, auth: req.headers.authorization, storage });
  if (!storage && key !== 'user-b' && key !== 'shared-env' && key !== 'user-a') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"code":401,"msg":"missing key"}');
    return;
  }
  if (storage) { res.end('file-data'); return; }
  if (path === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ok\n\n');
    return;
  }
  const data = path === '/openapi/v2/assets/files' ? { postUrl: `${origin}/storage/upload`, filePath: 'a', postFields: {} }
    : path === '/openapi/v2/assets/files/url' ? { fileUrl: `${origin}/storage/download` }
      : { userID: key === 'user-b' ? 2 : 1 };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 200, msg: '', requestId: 'fixture', data }));
});
beforeAll(async () => {
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
});
afterAll(async () => { fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve())); });
afterEach(() => { vi.unstubAllEnvs(); received.length = 0; });

const deferred = () => {
  let resolve!: (key: string) => void;
  const promise = new Promise<string>(done => { resolve = done; });
  return { promise, resolve };
};

describe('credential source selection', () => {
  it('reads a non-enumerable timeout once in each client and sends under its selected identity', async () => {
    const config = () => {
      let reads = 0;
      const value = Object.defineProperty({ apiHost: origin, apiKey: 'user-a' }, 'transportTimeoutMs', {
        get() { if (++reads !== 1) throw new Error('timeout read twice'); return 5000; }, enumerable: false,
      });
      return { value, reads: () => reads };
    };
    const httpConfig = config();
    await new HttpClient(httpConfig.value).get('/probe');
    const cloudConfig = config();
    await new CloudTransport(() => new HttpClient({ apiHost: origin, apiKey: 'user-a' }), cloudConfig.value).postText('/cloud', '{}');
    const combined = config();
    await createClient(combined.value).system.whoami();
    const source = config();
    await createSourceClient(source.value).documents.get({ id: '101' });
    const stream = config();
    await createStreamClient(stream.value).observations.get({ id: '202' });
    const uns = config();
    await createUnsDataClient(uns.value).recordFind({ collectionId: 'orders' });
    const data = config();
    await createDataTransport(data.value).call('catalog', {});
    for (const item of [httpConfig, cloudConfig, combined, source, stream, uns, data]) expect(item.reads()).toBe(1);
    expect(received).toHaveLength(7);
    expect(received.every(r => r.key === 'user-a' && r.auth === undefined)).toBe(true);
  });

  it('preserves inherited transport limits and delegated subject in standalone clients', async () => {
    const config = Object.assign(Object.create({ unsV2MaxResponseBytes: 1 }), { apiHost: origin, apiKey: 'user-a' });
    await expect(createSourceClient(config).documents.get({ id: '101' })).rejects.toThrow();
    await expect(createStreamClient(config).observations.get({ id: '202' })).rejects.toThrow();
    await expect(createUnsDataClient(config).recordFind({ collectionId: 'orders' })).rejects.toThrow();
    expect(received).toHaveLength(3);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 200, msg: '', requestId: 'fixture', data: { count: 1, capped: false },
    })));
    const delegated = Object.assign(Object.create({ unsV2AppDataSubject: 'a.employee.c' }), { apiHost: origin, apiKey: 'user-a', fetch });
    await createUnsDataClient(delegated).recordCount({ collectionId: 'orders' });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-tier0-app-data-subject')).toBe('a.employee.c');
  });
  it('uses the environment only when all credential properties are absent', async () => {
    vi.stubEnv('TIER0_API_KEY', 'shared-env');
    const configs = [
      { apiKey: undefined }, { getApiKey: undefined }, { getApiKey: () => undefined },
      { apiKey: '', getApiKey: () => 'user-b' },
      { apiKey: undefined, getApiKey: () => 'user-b' },
      { apiKeyProvider: undefined, apiKey: 'user-b', getApiKey: () => 'user-b' },
    ];
    for (const config of configs) {
      const client = new HttpClient({ apiHost: origin, ...config });
      expect(await client.get('/probe').catch((e: unknown) => e)).toMatchObject({ status: 401 });
    }
    await new HttpClient({ apiHost: origin }).get('/probe');
    expect(received.map(r => [r.key ?? null, r.auth ?? null])).toEqual([
      [null, null], [null, null], [null, null], [null, null], [null, null], [null, null], ['shared-env', null],
    ]);
  });

  it.each([
    ['apiKey', undefined], ['apiKey', ''], ['getApiKey', undefined], ['getApiKey', () => undefined],
    ['apiKeyProvider', undefined],
  ] as const)('does not lose a non-enumerable %s during public client creation', async (field, value) => {
    vi.stubEnv('TIER0_API_KEY', 'shared-env');
    const config = Object.defineProperty({ apiHost: origin }, field, { value, enumerable: false });
    const client = createClient(config);
    await expect(client.system.whoami()).rejects.toMatchObject({ status: 401 });
    expect(received).toEqual([{ path: '/openapi/v2/auth/whoami', key: undefined, auth: undefined, storage: false }]);
  });

  it('preserves non-enumerable valid credential sources and employee delegation', async () => {
    vi.stubEnv('TIER0_API_KEY', 'shared-env');
    const syncConfig = Object.defineProperty({ apiHost: origin }, 'getApiKey', { value: () => 'user-b', enumerable: false });
    const asyncConfig = Object.defineProperty({ apiHost: origin }, 'apiKeyProvider', { value: async () => 'user-a', enumerable: false });
    const [a, b] = await Promise.all([createClient(syncConfig).system.whoami(), createClient(asyncConfig).system.whoami()]);
    expect(a.userID).toBe(2);
    expect(b.userID).toBe(1);
    expect(received.map(r => r.key).sort()).toEqual(['user-a', 'user-b']);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      code: 200, msg: 'ok', requestId: 'r', data: { count: 1, capped: false },
    })));
    const delegated = Object.defineProperty({ apiHost: origin, apiKey: 'user-a', fetch }, 'unsV2AppDataSubject', { value: 'a.employee.c', enumerable: false });
    await createClient(delegated).uns.recordCount({ collectionId: 'orders' });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-tier0-app-data-subject')).toBe('a.employee.c');
  });

  it.each(['http', 'cloud', 'stream', 'sse', 'upload', 'download'] as const)(
    'interleaves missing per-user identity with a distinct user for %s without a shared fallback', async kind => {
      vi.stubEnv('TIER0_API_KEY', 'shared-env');
      const a = createClient({ apiHost: origin, getApiKey: () => undefined });
      const b = createClient({ apiHost: origin, apiKey: 'user-b' });
      const httpA = new HttpClient({ apiHost: origin, getApiKey: () => undefined });
      const httpB = new HttpClient({ apiHost: origin, apiKey: 'user-b' });
      const run = (client: typeof a, http: HttpClient) => kind === 'http' ? client.system.whoami()
        : kind === 'cloud' ? new CloudTransport(() => http).postText('/cloud', '{}').then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`); return r;
          })
          : kind === 'stream' ? new CloudTransport(() => http).post('/stream', {}).then(r => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`); return r;
            })
          : kind === 'sse' ? new CloudTransport(() => http).getEventStream('/events').then(r => {
              if (r.status !== 200) throw new Error(`HTTP ${r.status}`); if ('close' in r) r.close(); return r;
            })
            : kind === 'upload' ? client.files.upload(new File(['content'], 'a.txt'))
              : client.files.download({ filePath: 'a' });
      const [resultA, resultB] = await Promise.allSettled([run(a, httpA), run(b, httpB)]);
      expect(resultA.status).toBe('rejected');
      expect(resultB.status).toBe('fulfilled');
      const path = kind === 'http' ? '/openapi/v2/auth/whoami' : kind === 'cloud' ? '/cloud' : kind === 'stream' ? '/stream'
        : kind === 'sse' ? '/events' : kind === 'upload' ? '/openapi/v2/assets/files' : '/openapi/v2/assets/files/url';
      expect(received.filter(r => !r.storage)).toEqual(expect.arrayContaining([
        { path, key: undefined, auth: undefined, storage: false },
        { path, key: 'user-b', auth: undefined, storage: false },
      ]));
      expect(received.filter(r => !r.storage)).toHaveLength(2);
      for (const request of received.filter(r => r.storage)) {
        expect(request).toMatchObject({ key: undefined, auth: undefined });
      }
      expect(received.filter(r => r.storage)).toHaveLength(kind === 'upload' || kind === 'download' ? 1 : 0);
      expect(received.some(r => r.key === 'shared-env')).toBe(false);
    }
  );

  it('snapshots each dynamic getter before interleaving with an asynchronous provider', async () => {
    vi.stubEnv('TIER0_API_KEY', 'shared-env');
    const pending = deferred();
    let current: string | undefined = 'user-b';
    const getter = vi.fn(() => current);
    const sync = new HttpClient({ apiHost: origin, getApiKey: getter });
    const asyncClient = new HttpClient({ apiHost: origin, apiKey: 'shared-env', getApiKey: () => 'shared-env', apiKeyProvider: () => pending.promise });
    const first = sync.get('/getter-one');
    const second = asyncClient.get('/provider');
    current = undefined;
    const third = sync.get('/getter-missing').catch((e: unknown) => e);
    pending.resolve('user-a');
    await first;
    await second;
    expect(await third).toMatchObject({ status: 401 });
    expect(getter).toHaveBeenCalledTimes(2);
    expect(received).toEqual(expect.arrayContaining([
      { path: '/getter-one', key: 'user-b', auth: undefined, storage: false },
      { path: '/provider', key: 'user-a', auth: undefined, storage: false },
      { path: '/getter-missing', key: undefined, auth: undefined, storage: false },
    ]));
    expect(received).toHaveLength(3);
  });

  it.each(['cloud', 'stream', 'sse', 'upload', 'download'] as const)(
    'keeps an async provider and a dynamic getter isolated through %s', async kind => {
      vi.stubEnv('TIER0_API_KEY', 'shared-env');
      const pending = deferred();
      let current: string | undefined = 'user-b';
      const aConfig = { apiHost: origin, apiKey: 'shared-env', apiKeyProvider: () => pending.promise };
      const bConfig = { apiHost: origin, getApiKey: () => current };
      const a = createClient(aConfig);
      const b = createClient(bConfig);
      const run = (client: typeof a, config: typeof aConfig | typeof bConfig) => {
        if (kind === 'cloud') return new CloudTransport(() => new HttpClient(config)).postText('/cloud', '{}');
        if (kind === 'stream') return new CloudTransport(() => new HttpClient(config)).post('/stream', {});
        if (kind === 'sse') return new CloudTransport(() => new HttpClient(config)).getEventStream('/events');
        if (kind === 'upload') return client.files.upload(new File(['content'], 'a.txt'));
        return client.files.download({ filePath: 'a' });
      };
      const first = run(a, aConfig);
      const second = run(b, bConfig);
      current = undefined;
      pending.resolve('user-a');
      const [one, two] = await Promise.all([first, second]);
      if (kind === 'sse') {
        if ('close' in one) one.close();
        if ('close' in two) two.close();
      }
      const path = kind === 'cloud' ? '/cloud' : kind === 'stream' ? '/stream' : kind === 'sse' ? '/events'
        : kind === 'upload' ? '/openapi/v2/assets/files' : '/openapi/v2/assets/files/url';
      expect(received.filter(r => !r.storage)).toEqual(expect.arrayContaining([
        { path, key: 'user-a', auth: undefined, storage: false },
        { path, key: 'user-b', auth: undefined, storage: false },
      ]));
      expect(received.filter(r => !r.storage)).toHaveLength(2);
      const storage = received.filter(r => r.storage);
      expect(storage).toHaveLength(kind === 'upload' || kind === 'download' ? 2 : 0);
      expect(storage.every(r => r.key === undefined && r.auth === undefined)).toBe(true);
    }
  );

  it.each(['http', 'cloud', 'stream', 'sse', 'upload', 'download'] as const)('fails before %s dispatch when an async provider returns undefined', async kind => {
    vi.stubEnv('TIER0_API_KEY', 'shared-env');
    const provider = vi.fn(async () => undefined as unknown as string);
    const config = { apiHost: origin, apiKey: 'user-b', apiKeyProvider: provider };
    const client = createClient(config);
    const http = new HttpClient(config);
    const cloud = new CloudTransport(() => http);
    const request = kind === 'http' ? http.get('/provider-invalid')
      : kind === 'cloud' ? cloud.postText('/provider-invalid', '{}')
        : kind === 'stream' ? cloud.post('/provider-invalid', {})
        : kind === 'sse' ? cloud.getEventStream('/provider-invalid')
          : kind === 'upload' ? client.files.upload(new File(['content'], 'a.txt'))
            : client.files.download({ filePath: 'a' });
    await expect(request).rejects.toThrow();
    expect(provider).toHaveBeenCalledOnce();
    expect(received).toEqual([]);
  });

  it('Data preflight rejects an absent explicit credential without sending an environment key', async () => {
    vi.stubEnv('TIER0_API_KEY', 'shared-env');
    const data = createDataTransport({ apiHost: origin, getApiKey: () => undefined });
    await expect(data.call('catalog', {})).rejects.toMatchObject({ code: 'DATA_NOT_CONFIGURED' });
    expect(received).toEqual([]);
  });
});
