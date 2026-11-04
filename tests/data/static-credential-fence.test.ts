import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataClient, runWithRequiredEmployeeContext } from '../../src/data/index.js';
import { defineCollection } from '../../src/data/define.js';
import { z } from 'zod';

const subject = 'X-Tier0-App-Data-Subject';
const collection = { collectionId: 'known-collection' };
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'test', data }), { status: 200 });
const safeFailure = () => new Response(JSON.stringify({ code: 503, msg: 'busy', requestId: 'test', data: null,
  error: { code: 'TEMPORARILY_UNAVAILABLE', reason: 'busy', details: [], execution: 'rolledBack', retry: { safe: true, afterMs: 0 } } }), { status: 503 });

afterEach(() => vi.unstubAllEnvs());

describe('static Data credential fence', () => {
  it('does not resend a write under a changed key after a safe failure', async () => {
    let credential = 'fixture-a';
    const seen: { key: string | null; body: Record<string, unknown>; subject: string | null }[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ key: headers.get('x-api-key'), subject: headers.get(subject), body: JSON.parse(String(init?.body)) });
      credential = 'fixture-b';
      return safeFailure();
    };
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => credential, fetch });
    await expect(runWithRequiredEmployeeContext(new Headers({ [subject]: 'a.employee.c' }), () =>
      data.collection(collection).insertOne({ value: 1 }, { idempotencyKey: 'same-intent' }),
    )).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED', execution: 'rolledBack', attempts: 1,
      idempotencyKey: 'same-intent', retry: { safe: false } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ key: 'fixture-a', subject: 'a.employee.c', body: { idempotencyKey: 'same-intent' } });
    credential = 'fixture-a';
    await expect(data.collection(collection).countDocuments()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED' });
    expect(seen).toHaveLength(1);
  });

  it('does not report a seeded collection ready when the key changes after ensure', async () => {
    let credential = 'fixture-a';
    const paths: string[] = [];
    const fetch: typeof globalThis.fetch = async url => {
      paths.push(new URL(String(url)).pathname);
      credential = 'fixture-b';
      return envelope({ appId: 'app-a', results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status: 'created' }] });
    };
    const orders = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.number() }),
      seed: [{ _id: 'one', value: 1 }] });
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => credential, fetch, collections: [orders] });
    await expect(data.ensure()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED', retry: { safe: false } });
    await expect(data.ensure()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED', retry: { safe: false } });
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('/ensure');
  });

  it('rejects changed host and never calls the second endpoint', async () => {
    let host = 'https://one.invalid';
    const sent: string[] = [];
    const fetch: typeof globalThis.fetch = async url => { sent.push(String(url)); return envelope({ count: 1, capped: false }); };
    const data = createDataClient({ getApiHost: () => host, apiKey: 'fixture-key', fetch });
    await data.collection(collection).countDocuments();
    host = 'https://two.invalid';
    await expect(data.collection(collection).countDocuments()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('one.invalid');
  });

  it('does not dispatch a concurrent request under a different key', async () => {
    let credential = 'fixture-a';
    let release!: () => void;
    let started!: () => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => credential,
      fetch: async (_url, init) => {
        seen.push(new Headers(init?.headers).get('x-api-key')!);
        started();
        await gate;
        return envelope({ count: 1, capped: false });
      } });
    const first = data.collection(collection).countDocuments();
    await inFlight;
    credential = 'fixture-b';
    await expect(data.collection(collection).countDocuments()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED' });
    release();
    await expect(first).resolves.toMatchObject({ count: 1 });
    expect(seen).toEqual(['fixture-a']);
  });

  it('never substitutes an environment credential for an empty explicit getter', async () => {
    vi.stubEnv('TIER0_API_KEY', 'fixture-env-key');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => undefined, fetch });
    const error = await data.collection(collection).countDocuments().catch(e => e);
    expect(error).toMatchObject({ code: 'DATA_NOT_CONFIGURED', execution: 'notStarted', retry: { safe: false } });
    expect(JSON.stringify(error)).not.toContain('fixture-env-key');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not expose a getter failure or send a request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => { throw new Error('private-fixture-value'); }, fetch });
    const error = await data.collection(collection).countDocuments().catch(e => e);
    expect(error).toMatchObject({ code: 'DATA_NOT_CONFIGURED', retry: { safe: false } });
    expect(String(error)).not.toContain('private-fixture-value');
    expect(JSON.stringify(error)).not.toContain('private-fixture-value');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the value checked for the same dispatch even with a changing getter', async () => {
    let calls = 0;
    const seen: string[] = [];
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => ++calls === 1 ? 'fixture-a' : 'fixture-b',
      fetch: async (_url, init) => { seen.push(new Headers(init?.headers).get('x-api-key')!); return envelope({ count: 1, capped: false }); } });
    await data.collection(collection).countDocuments();
    expect(calls).toBe(1);
    expect(seen).toEqual(['fixture-a']);
    await expect(data.collection(collection).countDocuments()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED' });
    expect(seen).toEqual(['fixture-a']);
  });

  it('does not reconnect a subscription under a different key', async () => {
    let credential = 'fixture-a';
    let sent = 0;
    const event = { eventId: 'event-1', collectionId: 'known-collection', recordId: 'r1', revision: 1,
      change: 'record', occurredAt: 1, restricted: false };
    const fetch: typeof globalThis.fetch = async () => {
      sent++;
      credential = 'fixture-b';
      return new Response(`id: event-1\nevent: change\ndata: ${JSON.stringify(event)}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => credential, fetch });
    const stream = data.subscribe({ collections: [collection] });
    expect((await stream.next()).value).toMatchObject({ type: 'change', eventId: 'event-1' });
    await expect(stream.next()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED', retry: { safe: false } });
    expect(sent).toBe(1);
  });

  it('keeps a dispatched write outcome unknown without resending after key change', async () => {
    let credential = 'fixture-a';
    let sent = 0;
    const data = createDataClient({ apiHost: 'https://gateway.invalid', getApiKey: () => credential,
      fetch: async () => { sent++; credential = 'fixture-b'; throw new Error('connection lost'); } });
    const error = await data.collection(collection).insertOne({ value: 1 }, { idempotencyKey: 'unknown-intent' }).catch(e => e);
    expect(error).toMatchObject({ execution: 'unknown', outcomeUnknown: true, idempotencyKey: 'unknown-intent' });
    expect(sent).toBe(1);
    await expect(data.collection(collection).countDocuments()).rejects.toMatchObject({ code: 'DATA_CREDENTIAL_CHANGED' });
    expect(sent).toBe(1);
  });

  it('does not replay an unknown write even when the server suggests retry is safe', async () => {
    let sent = 0;
    const data = createDataClient({ apiHost: 'https://gateway.invalid', apiKey: 'fixture-key', fetch: async () => {
      sent++;
      return new Response(JSON.stringify({ code: 503, msg: 'unknown', requestId: 'test', data: null,
        error: { code: 'OUTCOME_UNKNOWN', reason: 'unknown', details: [], execution: 'unknown', retry: { safe: true, afterMs: 0 } } }), { status: 503 });
    } });
    const error = await data.collection(collection).insertOne({ value: 1 }, { idempotencyKey: 'unknown-intent' }).catch(e => e);
    expect(error).toMatchObject({ execution: 'unknown', outcomeUnknown: true, retry: { safe: false }, idempotencyKey: 'unknown-intent' });
    expect(sent).toBe(1);
  });

  it('does not replay a committed write even when the server suggests retry is safe', async () => {
    let sent = 0;
    const data = createDataClient({ apiHost: 'https://gateway.invalid', apiKey: 'fixture-key', fetch: async () => {
      sent++;
      return new Response(JSON.stringify({ code: 503, msg: 'committed', requestId: 'test', data: null,
        error: { code: 'TEMPORARILY_UNAVAILABLE', reason: 'committed', details: [], execution: 'committed', retry: { safe: true, afterMs: 0 } } }), { status: 503 });
    } });
    const error = await data.collection(collection).insertOne({ value: 1 }, { idempotencyKey: 'committed-intent' }).catch(e => e);
    expect(error).toMatchObject({ execution: 'committed', retry: { safe: false }, idempotencyKey: 'committed-intent' });
    expect(sent).toBe(1);
  });
});
