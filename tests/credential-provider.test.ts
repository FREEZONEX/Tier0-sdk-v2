import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/openapi/client.js';
import { CloudTransport } from '../src/cloud-transport.js';
import { createDataClient } from '../src/data/client.js';
import { createClient } from '../src/index.js';

const host = 'https://fixture.invalid';
const json = () => new Response('{"code":200,"data":{}}', { headers: { 'Content-Type': 'application/json' } });
const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(done => { resolve = done; });
  return { promise, resolve };
};

function capture() {
  const headers: Headers[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    headers.push(new Headers(init?.headers));
    return json();
  };
  return { headers, fetch };
}

describe('async API key provider', () => {
  it('uses the provider through the public client API', async () => {
    const seen = capture();
    let count = 0;
    const client = createClient({ apiHost: host, fetch: seen.fetch, apiKeyProvider: async () => `key-${++count}` });
    await client.system.whoami();
    await client.system.whoami();
    expect(seen.headers.map(h => h.get('x-api-key'))).toEqual(['key-1', 'key-2']);
  });

  it('resolves independently for concurrent HTTP attempts and freezes both headers', async () => {
    const pending = [deferred(), deferred()];
    let index = 0;
    const seen = capture();
    const client = new HttpClient({ apiHost: host, apiKey: 'old-key', fetch: seen.fetch,
      apiKeyProvider: () => pending[index++].promise });
    const first = client.get('/one');
    const second = client.get('/two');
    await Promise.resolve();
    pending[1].resolve('second-key');
    pending[0].resolve('first-key');
    await Promise.all([first, second]);
    expect(seen.headers.map(h => [h.get('x-api-key'), h.get('authorization')]).sort()).toEqual([
      ['first-key', 'Bearer first-key'], ['second-key', 'Bearer second-key'],
    ]);
  });

  it.each(['reject', 'empty', 'invalid'] as const)('fails closed and redacts a %s provider result', async mode => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new HttpClient({ apiHost: host, apiKey: 'old-key', getApiKey: () => 'fallback', fetch,
      apiKeyProvider: async () => {
        if (mode === 'reject') throw new Error('sensitive-provider-detail');
        return mode === 'empty' ? '' : 'invalid\nvalue';
      } });
    await expect(client.post('/write', {})).rejects.toThrow('credential provider failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['http', 'cloud', 'sse', 'post'] as const)('does not send a %s request after provider timeout or cancellation', async kind => {
    for (const cancel of [false, true]) {
      const pending = deferred();
      const fetch = vi.fn<typeof globalThis.fetch>();
      const http = new HttpClient({ apiHost: host, apiKey: 'old-key', fetch, transportTimeoutMs: 20,
        apiKeyProvider: () => pending.promise });
      const cloud = new CloudTransport(() => http, { transportTimeoutMs: 20 });
      const controller = new AbortController();
      const request = kind === 'http' ? http.post('/write', {}, { signal: controller.signal })
        : kind === 'cloud' ? cloud.postText('/write', '{}', { signal: controller.signal })
          : kind === 'sse' ? cloud.getEventStream('/events', { signal: controller.signal })
            : cloud.post('/write', {}, controller.signal);
      const result = expect(request).rejects.toThrow();
      if (cancel) controller.abort();
      await result;
      pending.resolve('late-key');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it.each(['cloud', 'sse', 'post'] as const)('does not fall back on provider failure in %s transport', async kind => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const http = new HttpClient({ apiHost: host, apiKey: 'old-key', fetch,
      apiKeyProvider: async () => { throw new Error('private-detail'); } });
    const cloud = new CloudTransport(() => http);
    const request = kind === 'cloud' ? cloud.postText('/write', '{}')
      : kind === 'sse' ? cloud.getEventStream('/events') : cloud.post('/write', {});
    const error = await request.catch((failure: unknown) => failure);
    expect(String(error)).not.toContain('private-detail');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves each cloud POST and SSE connection independently, preserving the cursor', async () => {
    const seen = capture();
    let count = 0;
    const http = new HttpClient({ apiHost: host, fetch: seen.fetch, apiKeyProvider: async () => `key-${++count}` });
    const cloud = new CloudTransport(() => http);
    await cloud.postText('/write', '{}');
    await cloud.getEventStream('/events', { lastEventId: 'cursor-1' });
    await cloud.getEventStream('/events', { lastEventId: 'cursor-2' });
    expect(seen.headers.map(h => [h.get('x-api-key'), h.get('authorization'), h.get('last-event-id')])).toEqual([
      ['key-1', 'Bearer key-1', null], ['key-2', 'Bearer key-2', 'cursor-1'], ['key-3', 'Bearer key-3', 'cursor-2'],
    ]);
  });

  it('rejects provider use by the high-level Data client before making any request', () => {
    const provider = vi.fn(async () => 'unused');
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(() => createDataClient({ apiHost: host, apiKeyProvider: provider, fetch })).toThrow('not supported by createDataClient');
    expect(provider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
