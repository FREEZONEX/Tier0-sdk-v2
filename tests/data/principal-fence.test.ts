import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createBootstrap } from '../../src/data/bootstrap.js';
import type { DataCall } from '../../src/data/call.js';
import { defineCollection } from '../../src/data/define.js';
import { DataError } from '../../src/data/error.js';
import { DataPrincipalError, DataPrincipalFence, type VerifiedDataPrincipal } from '../../src/data/principal.js';
import { createSubscribe } from '../../src/data/subscribe.js';

const proof = (overrides: Partial<VerifiedDataPrincipal> = {}): VerifiedDataPrincipal => ({
  authority: 'issuer', workspace: 'workspace', credentialPrincipal: 'app-a',
  effectivePrincipal: 'app-a', idempotencyScope: 'scope-a', ...overrides,
});
const attempt = (credential: string, dataSubject?: string, signal = new AbortController().signal) =>
  ({ credential, endpoint: 'https://gateway.example', dataSubject, signal });

describe('internal Data principal preparation (fake verifier only)', () => {
  it('refreshes credentials for each attempt without caching keys and pins the logical identity', async () => {
    const verify = vi.fn(async () => proof());
    const fence = new DataPrincipalFence(verify);
    const op = fence.operation();
    const a = await op.prepare(attempt('key-1'));
    const b = await op.prepare(attempt('key-2'));
    expect([a.credential, b.credential]).toEqual(['key-1', 'key-2']);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fence)).not.toContain('key-');
    a.assertCurrent(); b.assertCurrent();
  });

  it('poisons outstanding leases if another concurrent attempt establishes a different App', async () => {
    let release!: (value: VerifiedDataPrincipal) => void;
    const fence = new DataPrincipalFence(async ({ credential }) => credential === 'slow'
      ? new Promise(resolve => { release = resolve; }) : proof({ credentialPrincipal: 'app-b' }));
    const first = fence.operation();
    const slow = first.prepare(attempt('slow'));
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = await fence.operation().prepare(attempt('other'));
    release(proof());
    await expect(slow).rejects.toBeInstanceOf(DataPrincipalError);
    expect(() => second.assertCurrent()).toThrow(DataPrincipalError);
    await expect(fence.operation().prepare(attempt('other'))).rejects.toBeInstanceOf(DataPrincipalError);
  });

  it('can reject a cached ensure result after another attempt changes App', async () => {
    const collection = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }) });
    const fence = new DataPrincipalFence(async ({ credential }) => proof({ credentialPrincipal: credential }));
    const op = fence.operation();
    const lease = await op.prepare(attempt('app-a'));
    const call = vi.fn(async () => ({ appId: 'app-a', results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status: 'unchanged' }] }));
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [collection], environment: 'preview',
      logger: { info() {}, warn() {}, error() {} } });
    const guardedEnsure = async () => { lease.assertCurrent(); const value = await bootstrap.ensure(); lease.assertCurrent(); return value; };
    await guardedEnsure();
    await expect(fence.operation().prepare(attempt('app-b'))).rejects.toBeInstanceOf(DataPrincipalError);
    await expect(guardedEnsure()).rejects.toBeInstanceOf(DataPrincipalError);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('keeps concurrent employees separate and rejects changed employee or idempotency scope inside one operation', async () => {
    const fence = new DataPrincipalFence(async ({ dataSubject }) => proof({
      effectivePrincipal: dataSubject ?? 'app-a', idempotencyScope: dataSubject ?? 'app-scope',
    }));
    const alice = fence.operation();
    const bob = fence.operation();
    await alice.prepare(attempt('key', 'alice'));
    const bobAttempt = await bob.prepare(attempt('key', 'bob'));
    await expect(alice.prepare(attempt('key', 'bob'))).rejects.toBeInstanceOf(DataPrincipalError);
    bobAttempt.assertCurrent();
    const rotatedScope = new DataPrincipalFence(async ({ credential }) => proof({ idempotencyScope: credential }));
    const op = rotatedScope.operation();
    await op.prepare(attempt('scope-1'));
    await expect(op.prepare(attempt('scope-2'))).rejects.toBeInstanceOf(DataPrincipalError);
  });

  it('fails closed on an unconfirmed proof, abort, and endpoint change; late proof cannot bind', async () => {
    const bad = new DataPrincipalFence(async () => { throw new Error('private credential detail'); });
    const error = await bad.operation().prepare(attempt('secret')).catch(e => e);
    expect(error).toBeInstanceOf(DataPrincipalError);
    expect(String(error)).not.toContain('private credential detail');
    let release!: (value: VerifiedDataPrincipal) => void;
    const fence = new DataPrincipalFence(async ({ credential }) => credential === 'pending'
      ? new Promise(resolve => { release = resolve; }) : proof({ credentialPrincipal: 'app-b' }));
    const controller = new AbortController();
    const pending = fence.operation().prepare(attempt('pending', undefined, controller.signal));
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DataPrincipalError);
    release(proof());
    const next = fence.operation();
    await next.prepare(attempt('new'));
    await expect(next.prepare({ ...attempt('new'), endpoint: 'https://other.example' })).rejects.toBeInstanceOf(DataPrincipalError);
  });

  it('freezes the attempt inputs and refuses dispatch after cancellation', async () => {
    let release!: (value: VerifiedDataPrincipal) => void;
    const verify = vi.fn((_input: Parameters<ConstructorParameters<typeof DataPrincipalFence>[0]>[0]) =>
      new Promise<VerifiedDataPrincipal>(resolve => { release = resolve; }));
    const fence = new DataPrincipalFence(verify);
    const controller = new AbortController();
    const input = attempt('original-key', 'employee-a', controller.signal);
    const pending = fence.operation().prepare(input);
    input.credential = 'other-key'; input.endpoint = 'https://other.example'; input.dataSubject = 'employee-b';
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(verify.mock.calls[0][0]).toMatchObject({ credential: 'original-key', endpoint: 'https://gateway.example', dataSubject: 'employee-a' });
    release(proof());
    const prepared = await pending;
    controller.abort();
    expect(() => prepared.assertCurrent()).toThrow(DataPrincipalError);
  });

  it('allows later re-verification of the same principal after a transient failure, invalidating earlier leases', async () => {
    let n = 0;
    const fence = new DataPrincipalFence(async () => {
      if (++n === 2) throw new Error('temporary verifier failure');
      return proof();
    });
    const operation = fence.operation();
    const before = await operation.prepare(attempt('first'));
    await expect(operation.prepare(attempt('second'))).rejects.toBeInstanceOf(DataPrincipalError);
    expect(() => before.assertCurrent()).toThrow(DataPrincipalError);
    const recovered = await operation.prepare(attempt('third'));
    recovered.assertCurrent();
  });

  it('does not treat seed principal failure as a successful cached ensure', async () => {
    const seeded = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }),
      seed: [{ _id: 'one', value: 'one' }] });
    const call = vi.fn(async (op: string) => {
      if (op === 'appCollectionsEnsure') return { appId: 'app-a', results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status: 'created' }] };
      throw new DataPrincipalError();
    });
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [seeded], environment: 'preview',
      logger: { info() {}, warn() {}, error() {} } });
    await expect(bootstrap.ensure()).rejects.toBeInstanceOf(DataPrincipalError);
    expect(call.mock.calls.map(args => args[0])).toEqual(['appCollectionsEnsure', 'recordBulkWrite']);
    await expect(bootstrap.ensure()).rejects.toBeInstanceOf(DataPrincipalError);
    expect(call.mock.calls.filter(args => args[0] === 'appCollectionsEnsure')).toHaveLength(2);
    expect(call.mock.calls.filter(args => args[0] === 'recordBulkWrite')).toHaveLength(1);
  });

  it('resumes an unsent seed after created becomes unchanged without caching an incomplete ensure', async () => {
    const seeded = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }),
      seed: [{ _id: 'one', value: 'one' }] });
    let ensures = 0;
    const anchors: object[] = [];
    const keys: string[] = [];
    const call = vi.fn(async (op: string, body: Record<string, unknown>, options?: { seedOperation?: object }) => {
      if (op === 'appCollectionsEnsure') return { appId: 'app-a', results: [{ alias: 'orders', collectionId: 'c1', revision: 1,
        status: ensures++ === 0 ? 'created' : 'unchanged' }] };
      anchors.push(options!.seedOperation!); keys.push(String(body.idempotencyKey));
      if (keys.length === 1) throw new DataPrincipalError();
      return { insertedCount: 1 };
    });
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [seeded], environment: 'preview', prepareSeedRecovery: async () => {},
      logger: { info() {}, warn() {}, error() {} } });
    await expect(bootstrap.ensure()).rejects.toBeInstanceOf(DataPrincipalError);
    await expect(bootstrap.ensure()).resolves.toMatchObject({ appId: 'app-a' });
    await bootstrap.ensure();
    expect(ensures).toBe(2);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(anchors[0]).toBe(anchors[1]);
  });

  it('keeps an unknown seed pending across unchanged and a later ordinary error until confirmed', async () => {
    const seeded = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }),
      seed: [{ _id: 'one', value: 'one' }] });
    let ensures = 0;
    const keys: string[] = [];
    const anchors: object[] = [];
    const call = vi.fn(async (op: string, body: Record<string, unknown>, options?: { seedOperation?: object }) => {
      if (op === 'appCollectionsEnsure') return { appId: 'app-a', results: [{ alias: 'orders', collectionId: 'c1', revision: 1,
        status: ensures++ === 0 ? 'created' : 'unchanged' }] };
      keys.push(String(body.idempotencyKey)); anchors.push(options!.seedOperation!);
      if (keys.length === 1) throw new DataError({ message: 'unknown', status: 503, code: 'OUTCOME_UNKNOWN', execution: 'unknown' });
      if (keys.length === 2) throw new DataPrincipalError();
      if (keys.length === 3) throw new DataError({ message: 'denied', status: 403, code: 'FORBIDDEN', execution: 'notStarted' });
      return { insertedCount: 1, replayed: true };
    });
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [seeded], environment: 'preview', prepareSeedRecovery: async () => {},
      logger: { info() {}, warn() {}, error() {} } });
    const first = await bootstrap.ensure().catch(e => e);
    expect(first).toMatchObject({ execution: 'unknown', outcomeUnknown: true, idempotencyKey: keys[0] });
    const second = await bootstrap.ensure().catch(e => e);
    expect(second).toMatchObject({ execution: 'unknown', outcomeUnknown: true, idempotencyKey: keys[0], retry: { safe: false } });
    await expect(bootstrap.ensure()).resolves.toMatchObject({ appId: 'app-a' });
    expect(new Set(keys).size).toBe(1);
    expect(new Set(anchors).size).toBe(1);
    expect(ensures).toBe(3);
  });

  it('never resumes a pending seed when the ensured App or collection changes', async () => {
    const seeded = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }),
      seed: [{ _id: 'one', value: 'one' }] });
    let ensures = 0;
    let sends = 0;
    const call = vi.fn(async (op: string) => {
      if (op === 'appCollectionsEnsure') {
        const n = ensures++;
        return { appId: n === 1 ? 'app-b' : 'app-a', results: [{ alias: 'orders', collectionId: n === 2 ? 'c2' : 'c1',
          revision: 1, status: n === 0 ? 'created' : 'unchanged' }] };
      }
      sends++;
      throw new DataPrincipalError();
    });
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [seeded], environment: 'preview',
      logger: { info() {}, warn() {}, error() {} } });
    await expect(bootstrap.ensure()).rejects.toBeInstanceOf(DataPrincipalError);
    await expect(bootstrap.ensure()).rejects.toMatchObject({ code: 'SEED_RECOVERY_REQUIRED', retry: { safe: false } });
    await expect(bootstrap.ensure()).rejects.toMatchObject({ code: 'SEED_RECOVERY_REQUIRED', retry: { safe: false } });
    expect(sends).toBe(1);
  });

  it('retains a seed after unknown retries are exhausted and resumes only the unfinished chunk', async () => {
    const seeded = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }),
      seed: Array.from({ length: 201 }, (_, i) => ({ _id: `id-${i}`, value: 'x' })) });
    let ensures = 0;
    const calls: { key: string; count: number; anchor?: object }[] = [];
    const call = vi.fn(async (op: string, body: Record<string, unknown>, options?: { seedOperation?: object }) => {
      if (op === 'appCollectionsEnsure') return { appId: 'app-a', results: [{ alias: 'orders', collectionId: 'c1', revision: 1,
        status: ensures++ === 0 ? 'created' : 'unchanged' }] };
      calls.push({ key: String(body.idempotencyKey), count: (body.operations as unknown[]).length, anchor: options?.seedOperation });
      if (calls.length >= 2 && calls.length <= 4) throw new DataError({ message: 'unknown', status: 503, code: 'OUTCOME_UNKNOWN', execution: 'unknown' });
      if (calls.length === 5) throw new DataError({ message: 'temporarily denied', status: 403, code: 'FORBIDDEN', execution: 'notStarted' });
      return { insertedCount: calls.at(-1)!.count };
    });
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [seeded], environment: 'preview', prepareSeedRecovery: async () => {},
      logger: { info() {}, warn() {}, error() {} } });
    const failure = await bootstrap.ensure().catch(e => e);
    expect(failure).toMatchObject({ execution: 'unknown', outcomeUnknown: true, idempotencyKey: calls[1].key, retry: { safe: false } });
    const stillUnknown = await bootstrap.ensure().catch(e => e);
    expect(stillUnknown).toMatchObject({ execution: 'unknown', outcomeUnknown: true, idempotencyKey: calls[1].key, retry: { safe: false } });
    await expect(bootstrap.ensure()).resolves.toMatchObject({ appId: 'app-a' });
    expect(calls.map(c => c.count)).toEqual([200, 1, 1, 1, 1, 1]);
    expect(new Set(calls.slice(1).map(c => c.key)).size).toBe(1);
    expect(new Set(calls.slice(1).map(c => c.anchor)).size).toBe(1);
    expect(calls[0].anchor).not.toBe(calls[1].anchor);
  });

  it('keeps the seed idempotency key but does not replay an unknown write under a different App', async () => {
    const seeded = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }),
      seed: [{ _id: 'one', value: 'one' }] });
    const fence = new DataPrincipalFence(async ({ credential }) => proof({ credentialPrincipal: credential }));
    const seedOperation = fence.operation();
    const observed: string[] = [];
    let seedAttempts = 0;
    let seedSends = 0;
    const call = vi.fn(async (op: string, body: Record<string, unknown>) => {
      if (op === 'appCollectionsEnsure') {
        await fence.operation().prepare(attempt('app-a'));
        return { appId: 'app-a', results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status: 'created' }] };
      }
      observed.push(String(body.idempotencyKey));
      const prepared = await seedOperation.prepare(attempt(seedAttempts++ === 0 ? 'app-a' : 'app-b'));
      prepared.assertCurrent();
      seedSends++;
      throw new DataError({ message: 'outcome unknown', status: 503, code: 'OUTCOME_UNKNOWN', execution: 'unknown' });
    });
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [seeded], environment: 'preview', prepareSeedRecovery: async () => {},
      logger: { info() {}, warn() {}, error() {} } });
    const error = await bootstrap.ensure().catch(e => e);
    expect(error).toBeInstanceOf(DataPrincipalError);
    expect(error).toMatchObject({ execution: 'unknown', outcomeUnknown: true, retry: { safe: false }, idempotencyKey: observed[0] });
    expect(observed).toHaveLength(2);
    expect(observed[0]).toBe(observed[1]);
    expect(seedAttempts).toBe(2);
    expect(seedSends).toBe(1);
  });

  it('does not replay a stale operation after the rebuild sees another App', async () => {
    const collection = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }) });
    const fence = new DataPrincipalFence(async ({ credential }) => proof({ credentialPrincipal: credential }));
    let ensureAttempts = 0;
    const call = vi.fn(async () => {
      const op = fence.operation();
      const prepared = await op.prepare(attempt(ensureAttempts++ === 0 ? 'app-a' : 'app-b'));
      prepared.assertCurrent();
      return { appId: 'app-a', results: [{ alias: 'orders', collectionId: 'old-id', revision: 1, status: 'unchanged' }] };
    });
    const bootstrap = createBootstrap({ call: call as unknown as DataCall, collections: [collection], environment: 'preview',
      logger: { info() {}, warn() {}, error() {} } });
    const business = vi.fn(async () => { throw new DataError({ message: 'stale', status: 404, code: 'NOT_FOUND',
      reason: 'COLLECTION_NOT_FOUND', details: { collectionId: 'old-id' } }); });
    await expect(bootstrap.recover(business)).rejects.toBeInstanceOf(DataPrincipalError);
    expect(business).toHaveBeenCalledTimes(1);
    expect(ensureAttempts).toBe(2);
  });

  it('stops an actual subscription reconnect before sending with a changed App', async () => {
    const definition = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.string() }) });
    const fence = new DataPrincipalFence(async ({ credential }) => proof({ credentialPrincipal: credential }));
    const op = fence.operation();
    let opens = 0;
    const state = { appId: 'app-a', results: [], collectionIds: new Map([['orders', 'c1']]), conflicts: [] };
    const subscribe = createSubscribe({ declared: [definition], lookup: () => definition, subject: () => undefined,
      ensure: async () => state, rebuild: async () => false, resolve: async () => 'c1',
      openStream: async function* (_request, options) {
        const prepared = await op.prepare(attempt(opens === 0 ? 'app-a' : 'app-b', undefined, options.signal));
        prepared.assertCurrent(); opens++;
        yield { type: 'change' as const, eventId: 'event-1', collectionId: 'c1', recordId: 'r1', revision: 1,
          change: 'record' as const, occurredAt: 1, restricted: false };
      } });
    const stream = subscribe();
    expect((await stream.next()).value).toMatchObject({ eventId: 'event-1' });
    await expect(stream.next()).rejects.toBeInstanceOf(DataPrincipalError);
    expect(opens).toBe(1);
  });
});
