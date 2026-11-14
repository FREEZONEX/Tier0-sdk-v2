import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection, runWithAbortSignal } from '../../src/data/index.js';

const codes = defineCollection({ alias: 'codes', name: 'Codes', schema: z.object({ code: z.string() }), indexes: [{ path: 'code', unique: true }] });
const logs = defineCollection({ alias: 'logs', name: 'Logs', schema: z.object({ at: z.number().int() }), indexes: [{ path: 'at', expireAfterSeconds: 60 }] });
const plain = defineCollection({ alias: 'plain', name: 'Plain', schema: z.object({ label: z.string() }) });
const ready = (spec: object = { paths: ['code'], unique: true, kind: 'btree', target: 'records' }, state = 'ready') => ({ spec, state, name: 'opaque', error: 'PRIVATE-DUPLICATE-VALUE' });
function fixture() {
  const calls: { path: string; body: any }[] = [];
  let appId = 'test-app', collectionId = 'c-codes';
  let states: unknown[] = [ready()];
  let denied = false;
  let conflict = false;
  let recoverBuilding = false;
  let ensuredCodeId = 'c-codes';
  const data = createDataClient({ collections: [codes, logs, plain], apiHost: 'https://isolated.invalid', apiKey: 'test-only',
    environment: 'deployed',
    logger: { info() {}, warn() {}, error() {} }, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body));
      calls.push({ path, body });
      if (path.endsWith('/ensure') && conflict && body.collections.some((d: any) => d.alias === 'codes')) return Response.json({
        code: 409, msg: 'Schema conflict', requestId: 'r', data: { conflicts: [{ alias: 'codes', collectionId: 'c-codes', reason: 'TYPE_MISMATCH' }] },
        error: { code: 'SCHEMA_CONFLICT', execution: 'notStarted', retry: { safe: false }, details: [] },
      }, { status: 409 });
      if (path.endsWith('/ensure')) return Response.json({ code: 200, msg: 'ok', requestId: 'r', data: {
        appId: 'test-app', results: body.collections.map((d: any) => ({ alias: d.alias, collectionId: d.alias === 'codes' ? ensuredCodeId : 'c-' + d.alias, status: 'unchanged', revision: 1,
          // Cached ensure deliberately says ready, while App context may disagree.
          indexStatus: [ready()] })),
      } });
      if (path.endsWith('/context')) {
        if (denied) return Response.json({ code: 403, msg: 'Denied', requestId: 'r', data: null,
          error: { code: 'FORBIDDEN', execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 403 });
        return Response.json({ code: 200, msg: 'ok', requestId: 'r', data: { appId, collections: [
          { alias: 'CODES', collectionId, indexStatus: states },
          { alias: 'logs', collectionId: 'c-logs', indexStatus: [ready({ path: 'at', expireAfterSeconds: 60 }, 'building')] },
        ] } });
      }
      if (path.endsWith('/records:transact')) {
        if (recoverBuilding) {
          recoverBuilding = false; collectionId = ensuredCodeId = 'c-codes-v2'; states = [ready(undefined, 'building')];
          return Response.json({ code: 403, msg: 'Collection reset', requestId: 'r',
            data: { reason: 'COLLECTION_NOT_FOUND', collectionId: 'c-codes' },
            error: { code: 'FORBIDDEN', execution: 'notStarted', retry: { safe: false }, details: [] },
          }, { status: 403 });
        }
        return Response.json({ code: 200, msg: 'ok', requestId: 'r', data: { status: 'committed', results: [] } });
      }
      throw new Error('Unexpected request: ' + path);
    } });
  return { data, calls, states(value: unknown[]) { states = value; },
    app(value: string) { appId = value; }, collection(value: string) { collectionId = value; }, deny() { denied = true; }, conflict() { conflict = true; },
    resetOnTransaction() { recoverBuilding = true; } };
}

describe('data.assertIndexesReady', () => {
  it('uses App-key context and a fresh state on every call, not the memoized ensure response', async () => {
    const f = fixture();
    f.states([ready(undefined, 'building')]);
    await expect(f.data.assertIndexesReady([codes])).rejects.toMatchObject({ code: 'INDEX_NOT_READY', status: 503 });
    f.states([ready()]);
    await f.data.assertIndexesReady([codes]);
    expect(f.calls.filter(c => c.path.endsWith('/ensure'))).toHaveLength(1);
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(2);
    expect(f.calls.filter(c => c.path.endsWith('/context')).every(c => Object.keys(c.body).length === 0)).toBe(true);
    expect(f.calls.every(c => c.path.endsWith('/ensure') || c.path.endsWith('/context'))).toBe(true);
  });

  it('checks all declared indexes by default; selecting codes does not require unrelated TTL readiness', async () => {
    const f = fixture();
    await expect(f.data.assertIndexesReady()).rejects.toMatchObject({ code: 'INDEX_NOT_READY', details: { alias: 'logs' } });
    await f.data.assertIndexesReady([codes]);
  });

  it.each(['building', 'pending', 'unknown', ''])('does not accept state %s as ready', async state => {
    const f = fixture(); f.states([ready(undefined, state)]);
    await expect(f.data.assertIndexesReady([codes])).rejects.toMatchObject({ code: 'INDEX_NOT_READY', execution: 'notStarted' });
  });

  it('surfaces failed indexes without forwarding diagnostic business values', async () => {
    const f = fixture(); f.states([ready(undefined, 'failed')]);
    try { await f.data.assertIndexesReady([codes]); throw Error('Expected failure'); }
    catch (error: any) {
      expect(error.code).toBe('INDEX_BUILD_FAILED');
      expect(JSON.stringify(error) + error.message).not.toContain('PRIVATE-DUPLICATE-VALUE');
    }
  });

  it.each([
    [], [ready(), ready()], [ready({ path: 'code' })],
    [ready({ path: 'code', unique: true, target: 'samples' })],
    [ready({ paths: ['other', 'code'], unique: true })],
    [ready({ path: 'code', unique: true, where: { enabled: true } })],
  ])('rejects missing/ambiguous/different constraint states', async states => {
    const f = fixture(); f.states(states);
    await expect(f.data.assertIndexesReady([codes])).rejects.toMatchObject({ code: 'INDEX_NOT_READY' });
  });

  it('refuses another App and a replacement collection under the same alias', async () => {
    const f = fixture(); f.app('another-app');
    await expect(f.data.assertIndexesReady([codes])).rejects.toMatchObject({ code: 'DATA_BAD_RESPONSE' });
    f.app('test-app'); f.collection('replacement');
    await expect(f.data.assertIndexesReady([codes])).rejects.toMatchObject({ code: 'INDEX_NOT_READY' });
  });

  it('does not poll, repair or bypass an access refusal', async () => {
    const f = fixture(); f.deny();
    await expect(f.data.assertIndexesReady([codes])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(1);
  });

  it('requires a declaration from the same client, and skips I/O when none has indexes', async () => {
    const f = fixture();
    await f.data.assertIndexesReady([plain]);
    expect(f.calls).toHaveLength(0);
    const other = defineCollection({ ...codes });
    expect(() => f.data.assertIndexesReady([other])).toThrow(/this data client/);
    expect(f.calls).toHaveLength(0);
  });

  it('honors the request abort signal for the read without cancelling shared bootstrap', async () => {
    const f = fixture();
    await f.data.ensure();
    const controller = new AbortController(); controller.abort();
    await expect(runWithAbortSignal(controller.signal, () => f.data.assertIndexesReady([codes]))).rejects.toMatchObject({ code: 'DATA_ABORTED' });
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(0);
  });

  it('does not approve a deployment declaration served unchanged after a schema conflict', async () => {
    const f = fixture(); f.conflict();
    await expect(f.data.assertIndexesReady([codes])).rejects.toMatchObject({ code: 'SCHEMA_CONFLICT' });
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(0);
  });

  it('an already-aborted business write never enters transport even with free request slots', async () => {
    const f = fixture(); await f.data.ensure();
    const controller = new AbortController(); controller.abort();
    await expect(runWithAbortSignal(controller.signal, () => f.data.collection(codes).insertOne({ code: 'A' })))
      .rejects.toMatchObject({ code: 'DATA_ABORTED', execution: 'notStarted', attempts: 0 });
    expect(f.calls.every(c => c.path.endsWith('/ensure'))).toBe(true);
  });

  it('guards a transaction immediately before sending it and keeps the option out of the wire request', async () => {
    const f = fixture();
    const steps = [{ opId: 'create', action: 'record.create' as const, collection: codes, id: 'one', data: { code: 'A' } }];
    f.states([ready(undefined, 'building')]);
    await expect(f.data.transact(steps, { requireIndexesReady: true })).rejects.toMatchObject({ code: 'INDEX_NOT_READY' });
    expect(f.calls.filter(c => c.path.endsWith('/records:transact'))).toHaveLength(0);
    f.states([ready()]);
    await f.data.transact(steps, { requireIndexesReady: true, idempotencyKey: 'business-intent' });
    const sent = f.calls.at(-1)!;
    expect(sent.path).toContain('/records:transact');
    expect(sent.body.idempotencyKey).toBe('business-intent');
    expect(sent.body).not.toHaveProperty('requireIndexesReady');
    expect(f.calls.at(-2)!.path).toContain('/context');
  });

  it('rechecks rebuilt collection indexes before replaying a transaction after Preview reset', async () => {
    const f = fixture(); f.resetOnTransaction();
    await expect(f.data.transact([{ opId: 'create', action: 'record.create', collection: codes, id: 'one', data: { code: 'A' } }],
      { requireIndexesReady: true })).rejects.toMatchObject({ code: 'INDEX_NOT_READY', details: { collectionId: 'c-codes-v2' } });
    expect(f.calls.filter(c => c.path.endsWith('/ensure'))).toHaveLength(2);
    expect(f.calls.filter(c => c.path.endsWith('/context'))).toHaveLength(2);
    expect(f.calls.filter(c => c.path.endsWith('/records:transact'))).toHaveLength(1);
  });

  it('rejects readiness-guarded existing-ID references before any I/O', async () => {
    const f = fixture();
    await expect(f.data.transact([{ opId: 'check', action: 'record.check', collection: { collectionId: 'shared' }, id: 'one' }],
      { requireIndexesReady: true })).rejects.toThrow(/declared collections/);
    expect(f.calls).toHaveLength(0);
  });
});
