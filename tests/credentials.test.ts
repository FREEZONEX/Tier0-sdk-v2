import { mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { appCredentialClaims, decodeJwtClaims, readCredentialToken } from '../src/credentials.js';
import { createDataClient, defineCollection, runAsApp, runWithRequestContext } from '../src/data/index.js';
import { getCurrentAppId } from '../src/runtime-context.js';
import { z } from 'zod';

const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims: Record<string, unknown>, signature = 'sig') => `${segment({ alg: 'EdDSA', kid: 'k1' })}.${segment(claims)}.${signature}`;
const appToken = (signature = 'sig') => token({
  iss: 'sbx-control', aud: 'tier0-api', typ: 'app-credential', ws: '7205759403792793999', app: 'app_1', runtime: 'deployed', release: 'r1',
}, signature);

const envelope = (data: unknown = {}) => new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'r', data }), { status: 200, headers: { 'content-type': 'application/json' } });
const denied = () => new Response(JSON.stringify({ code: 401, msg: 'unauthorized' }), { status: 401 });

describe('App credential token file (design 21.7)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tier0-credentials-'));
    file = join(dir, 'app-token');
    writeFileSync(file, appToken('first'));
    vi.stubEnv('TIER0_CREDENTIALS_FILE', file);
    vi.stubEnv('TIER0_API_KEY', undefined);
    vi.stubEnv('APP_ID', undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  /** The guest agent's atomic replace: a new file renamed over the old one. */
  function replace(value: string) {
    const next = join(dir, `.app-token.tmp-${Math.random()}`);
    writeFileSync(next, value);
    renameSync(next, file);
  }

  it('sends the token as Bearer only, without X-API-Key', async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => envelope({ userId: 'u' }));
    await createClient({ apiHost: 'api.example', fetch }).api.system.whoami();
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${appToken('first')}`);
    expect(headers.get('x-api-key')).toBeNull();
  });

  it('reads the file once while its stat is unchanged, and follows an atomic replace', () => {
    expect(readCredentialToken(file)).toBe(appToken('first'));
    const stamp = new Date();
    utimesSync(file, stamp, stamp);
    // Same inode and size but a new mtime still rereads; content equal, so only the path is exercised.
    expect(readCredentialToken(file)).toBe(appToken('first'));
    replace(appToken('other'));
    expect(readCredentialToken(file)).toBe(appToken('other'));
  });

  it('does not reread the file while its stat is unchanged', async () => {
    const fs = await import('node:fs');
    readCredentialToken(file);
    const spy = vi.spyOn(process, 'getBuiltinModule').mockReturnValue({
      ...fs,
      readFileSync: () => { throw new Error('must not read'); },
    } as never);
    expect(readCredentialToken(file)).toBe(appToken('first'));
    spy.mockRestore();
  });

  it('rereads the file on 401 and retries once with the new token', async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => {
      if (fetch.mock.calls.length === 1) {
        replace(appToken('fresh'));
        return denied();
      }
      return envelope({ userId: 'u' });
    });
    await createClient({ apiHost: 'api.example', fetch }).api.system.whoami();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('authorization')).toBe(`Bearer ${appToken('fresh')}`);
  });

  it('throws when the retry is refused too, after exactly two requests', async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => denied());
    await expect(createClient({ apiHost: 'api.example', fetch }).api.system.whoami()).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 401 on a key the caller gave', async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => denied());
    await expect(createClient({ apiHost: 'api.example', apiKey: 'sk-key', fetch }).api.system.whoami()).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-api-key')).toBe('sk-key');
  });

  it('forwards the delegation as received on every interface, and not under runAsApp', async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => envelope({ userId: 'u' }));
    const client = createClient({ apiHost: 'api.example', fetch });
    const delegation = token({ typ: 'delegation' });
    const request = new Request('http://app/x', { headers: { 'X-Tier0-Delegation': delegation, 'X-Tier0-App-Data-Subject': 'a.b.c' } });
    await runWithRequestContext(request, () => client.api.system.whoami());
    await runWithRequestContext(request, () => runAsApp(() => client.api.system.whoami()));
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-tier0-delegation')).toBe(delegation);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-tier0-app-data-subject')).toBeNull();
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('x-tier0-delegation')).toBeNull();
  });

  it('keeps ensure App-level when a request triggers it', async () => {
    const orders = defineCollection({ alias: 'orders', name: 'orders', schema: z.object({ title: z.string() }) });
    const seen: Record<string, string | null> = {};
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const delegation = new Headers(init?.headers).get('x-tier0-delegation');
      if (String(url).includes('collections/ensure')) {
        seen.ensure = delegation;
        return envelope({ appId: 'app_1', results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status: 'unchanged', ignored: [], warnings: [], indexStatus: [] }] });
      }
      seen.count = delegation;
      return envelope({ count: 1, capped: false });
    });
    const data = createDataClient({ apiHost: 'api.example', fetch: fetch as typeof globalThis.fetch, collections: [orders], environment: 'deployed', logger: { info() {}, warn() {}, error() {} } as never });
    const delegation = token({ typ: 'delegation' });
    await runWithRequestContext(new Headers({ 'X-Tier0-Delegation': delegation }), () => data.collection(orders).countDocuments());
    expect(seen).toEqual({ ensure: null, count: delegation });
  });

  it('reads the workspace and App from the token, not the environment', () => {
    vi.stubEnv('APP_ID', 'not-used');
    expect(appCredentialClaims(appToken())?.ws).toBe('7205759403792793999');
    expect(getCurrentAppId()).toBe('app_1');
  });

  it('reports a missing file as not configured, without falling back to an API key', async () => {
    vi.stubEnv('TIER0_API_KEY', 'sk-old');
    rmSync(file);
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => envelope());
    const orders = defineCollection({ alias: 'orders', name: 'orders', schema: z.object({ title: z.string() }) });
    const data = createDataClient({ apiHost: 'api.example', fetch, collections: [orders], environment: 'deployed' });
    await expect(data.collection(orders).countDocuments()).rejects.toMatchObject({ code: 'DATA_NOT_CONFIGURED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores anything that is not an App credential token', () => {
    expect(decodeJwtClaims('sk-app-ws1_secret')).toBeUndefined();
    expect(appCredentialClaims(token({ typ: 'visitor', ws: '1', app: 'a' }))).toBeUndefined();
  });

  it('ships no command that could print the token', async () => {
    const { readFileSync } = await import('node:fs');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).bin).toBeUndefined();
  });
});
