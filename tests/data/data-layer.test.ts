import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { REBUILD_INTERVAL_MS, type EnsureResult } from '../../src/data/bootstrap.js';
import {
  compileCollection,
  createDataClient,
  currentDataSubject,
  DataError,
  defineCollection,
  runAsApp,
  runWithRequestContext,
  type DataClientConfig,
} from '../../src/data/index.js';
import { UnsV2Error } from '../../src/uns-v2/client.js';

const orders = defineCollection({
  alias: 'orders',
  schema: z.object({ code: z.string(), status: z.enum(['OPEN', 'DONE']), qty: z.number().int().optional() }),
  indexes: [{ path: 'code', unique: true }],
  seed: [
    { _id: 'o-1', code: 'A-1', status: 'OPEN' },
    { _id: 'o-2', code: 'A-2', status: 'DONE' },
  ],
});
const lines = defineCollection({
  alias: 'lines',
  schema: z.object({ orderId: z.string(), sku: z.string() }),
  seed: [{ _id: 'l-1', orderId: 'o-1', sku: 'S' }],
});

const SUBJECT_HEADER = 'x-tier0-app-data-subject';

interface Sent {
  url: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Reply = { status?: number; body: unknown } | ((sent: Sent) => { status?: number; body: unknown });

/** Mock UNS: replies are queued per path suffix (after /openapi/v2); the last one repeats. */
function mockUns(routes: Record<string, Reply | Reply[]>) {
  const sent: Sent[] = [];
  const queues = new Map(Object.entries(routes).map(([path, reply]) => [path, Array.isArray(reply) ? [...reply] : [reply]]));
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.slice(url.indexOf('/openapi/v2') + '/openapi/v2'.length);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const entry: Sent = { url, path, headers, body: JSON.parse(String(init?.body ?? '{}')) };
    sent.push(entry);
    const queue = queues.get(path);
    if (!queue) return new Response(JSON.stringify(failure(404, 'NOT_FOUND', null, `no mock for ${path}`).body), { status: 404 });
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    const reply = typeof next === 'function' ? next(entry) : next;
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, sent, calls: (path: string) => sent.filter(entry => entry.path === path) };
}

const ok = (data: unknown) => ({ body: { code: 200, msg: 'ok', requestId: 'req-1', data } });

/** UNS error envelope; `error.reason` repeats the message text, App data-access refusals add a stable `data.reason`. */
function failure(status: number, code: string, data: Record<string, unknown> | null = null, msg = code, retryable = status === 503) {
  return {
    status,
    body: {
      code: status,
      msg,
      requestId: 'req-err',
      data,
      error: {
        code,
        reason: msg,
        retryable,
        details: [],
        retryAdvice: { recommendedAction: 'inspectErrorAndCorrectRequest', canRetrySameRequest: retryable, keepIdempotencyKey: true },
      },
    },
  };
}
const fail = (status: number, code: string, data: Record<string, unknown> | null = null, msg = code) => failure(status, code, data, msg);
const fault = (status: number, code: string, message: string, data: Record<string, unknown> | null = null, retryable = false) =>
  failure(status, code, data, message, retryable);

const NOT_GRANTED = fault(403, 'FORBIDDEN', 'App has no permission for this Collection operation', {
  reason: 'COLLECTION_NOT_GRANTED',
  collectionId: 'c-orders',
  permission: 'record:read',
});
const GONE = fault(404, 'NOT_FOUND', 'object not found', { reason: 'COLLECTION_NOT_FOUND', collectionId: 'c-lines' });
const NO_UNS_DELETE = fault(403, 'FORBIDDEN', 'App has no permission for this Collection operation', {
  reason: 'APP_PERMISSION_MISSING',
  collectionId: 'c-orders',
  permission: 'record:delete',
  missingPermission: 'uns.delete',
});

function ensured(...results: Partial<EnsureResult>[]) {
  return ok({
    appId: 'app-1',
    results: results.map(result => ({ revision: 1, status: 'unchanged', ignored: [], warnings: [], indexStatus: [], ...result })),
  });
}

const silent = { info() {}, warn() {}, error() {} };

function client(mock: ReturnType<typeof mockUns>, overrides: Partial<DataClientConfig> = {}) {
  return createDataClient({
    collections: [orders, lines],
    fetch: mock.fetch,
    apiHost: 'http://gw.local:8795/',
    apiKey: 'sk-app',
    environment: 'preview',
    logger: silent,
    ...overrides,
  });
}

async function failed(promise: Promise<unknown>): Promise<DataError> {
  const error = await promise.then(() => undefined, (cause: unknown) => cause);
  expect(error, String(error)).toBeInstanceOf(DataError);
  return error as DataError;
}

const ENSURE = '/uns/app/collections/ensure';
const BOTH_UNCHANGED = ensured({ alias: 'orders', collectionId: 'c-orders' }, { alias: 'lines', collectionId: 'c-lines' });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('transport', () => {
  it('sends the App key through the SDK client and unwraps the envelope', async () => {
    const mock = mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/collections/c-orders/records:count': ok({ count: 7 }) });
    expect(await client(mock).collection(orders).countDocuments({ status: 'OPEN' })).toBe(7);
    const count = mock.calls('/uns/collections/c-orders/records:count')[0];
    expect(count.url).toBe('http://gw.local:8795/openapi/v2/uns/collections/c-orders/records:count');
    expect(count.headers['x-api-key']).toBe('sk-app');
    expect(count.body).toEqual({ collectionId: 'c-orders', filter: { status: 'OPEN' } });
  });

  it('maps UNS errors to DataError statuses and hints', async () => {
    const run = (reply: Reply, action: (data: ReturnType<typeof client>) => Promise<unknown>) => {
      const mock = mockUns({
        [ENSURE]: BOTH_UNCHANGED,
        '/uns/collections/c-orders/records': reply,
        '/uns/collections/c-orders/records:deleteOne': reply,
      });
      return failed(action(client(mock)));
    };
    const insert = (data: ReturnType<typeof client>) => data.collection(orders).insertOne({ code: 'A', status: 'OPEN' });

    const duplicate = await run(fail(409, 'DUPLICATE_KEY'), insert);
    expect(duplicate).toMatchObject({ status: 409, code: 'DUPLICATE_KEY', requestId: 'req-err', upstreamStatus: 409 });
    expect(duplicate.cause).toBeInstanceOf(UnsV2Error);

    expect((await run(fail(401, 'UNAUTHORIZED'), insert)).status).toBe(502);

    const noDelete = await run(NO_UNS_DELETE, data => data.collection(orders).deleteOne({ _id: 'o-1' }));
    expect(noDelete).toMatchObject({ status: 403, reason: 'APP_PERMISSION_MISSING' });
    expect(noDelete.message).toMatch(/uns\.delete/);
    expect((noDelete.cause as UnsV2Error).data).toMatchObject({ reason: 'APP_PERMISSION_MISSING' });
    // The hint follows data.reason, not the operation: a delete refused for another reason does not blame uns.delete.
    const deleteNotGranted = await run(NOT_GRANTED, data => data.collection(orders).deleteOne({ _id: 'o-1' }));
    expect(deleteNotGranted.reason).toBe('COLLECTION_NOT_GRANTED');
    expect(deleteNotGranted.message).not.toMatch(/uns\.delete/);

    const notReady = await run(fault(403, 'FORBIDDEN', 'hosted App is not ready', null, true), insert);
    expect(notReady).toMatchObject({ status: 503, upstreamStatus: 403, retryable: true });
    expect(notReady.message).toMatch(/retry shortly/);
    const denied = await run(fault(403, 'FORBIDDEN', 'employee cannot access this Record'), insert);
    expect(denied).toMatchObject({ status: 403, retryable: false });

    expect(await run(fail(503, 'TEMPORARILY_UNAVAILABLE'), insert)).toMatchObject({ status: 503, retryable: true });

    const archivedQuota = await run(fail(409, 'APP_QUOTA_EXCEEDED', { resource: 'archivedCollections', limit: 64 }), insert);
    expect(archivedQuota.status).toBe(409);
    expect(archivedQuota.details.resource).toBe('archivedCollections');
    expect(archivedQuota.message).toMatch(/64 archived collections/);
    expect((await run(fail(409, 'APP_QUOTA_EXCEEDED', { resource: 'indexes' }), insert)).message).toMatch(/64 indexes/);

    const tooLarge = await run(fail(409, 'COLLECTION_TOO_LARGE', { records: 2500, maxRecords: 2000 }), insert);
    expect(tooLarge.details.maxRecords).toBe(2000);
    expect(tooLarge.message).toMatch(/at most 2000 records/);
  });

  it('reports network failures without the gateway address, and missing configuration', async () => {
    const down = createDataClient({
      collections: [orders],
      fetch: (async () => {
        throw new TypeError('connect ECONNREFUSED');
      }) as typeof fetch,
      apiHost: 'http://secret-gw.internal:8795',
      apiKey: 'k',
      logger: silent,
    });
    const unreachable = await failed(down.ensure());
    expect(unreachable).toMatchObject({ code: 'DATA_UNREACHABLE', status: 503, retryable: true, outcomeUnknown: true });
    expect(unreachable.message).not.toMatch(/secret-gw/);

    vi.stubEnv('TIER0_API_HOST', '');
    vi.stubEnv('TIER0_API_KEY', '');
    const unconfigured = createDataClient({ collections: [orders], logger: silent });
    expect(await failed(unconfigured.ensure())).toMatchObject({ code: 'DATA_NOT_CONFIGURED', status: 503 });
    const keyless = createDataClient({ collections: [orders], apiHost: 'http://gw.local', logger: silent });
    expect(await failed(keyless.ensure())).toMatchObject({ code: 'DATA_NOT_CONFIGURED' });
  });

  it('treats unenveloped 502/503/504 from the gateway as retryable unavailability', async () => {
    const html = (status: number) => ({ status, body: `<html><body>${status} Service Temporarily Unavailable</body></html>` });
    const ensure = await failed(client(mockUns({ [ENSURE]: html(503) })).ensure());
    expect(ensure).toMatchObject({ code: 'HTTP_503', status: 503, upstreamStatus: 503, retryable: true, outcomeUnknown: true });
    expect(ensure.message).toMatch(/write outcome is unknown/);

    const read = await failed(client(mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/collections/c-orders/records:count': html(502) })).collection(orders).countDocuments());
    expect(read).toMatchObject({ code: 'HTTP_502', status: 503, upstreamStatus: 502, retryable: true, outcomeUnknown: false });

    const legacy = await failed(client(mockUns({ [ENSURE]: { status: 504, body: { code: 504, msg: 'gateway timeout' } } })).ensure());
    expect(legacy).toMatchObject({ code: 'HTTP_504', status: 503, retryable: true });

    // UNS v2 answers other errors with its envelope; an unenveloped one stays a bad response.
    const unenveloped = await failed(client(mockUns({ [ENSURE]: { status: 401, body: { code: 401, msg: 'unauthorized' } } })).ensure());
    expect(unenveloped).toMatchObject({ code: 'DATA_BAD_RESPONSE', status: 502, retryable: false });
  });

  it('marks a timed-out write as outcome unknown', async () => {
    const mock = mockUns({ [ENSURE]: BOTH_UNCHANGED });
    const stalled = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/records') ? new Promise<Response>(() => undefined) : mock.fetch(input, init)) as typeof fetch;
    const error = await failed(client(mock, { fetch: stalled, transportTimeoutMs: 20 }).collection(orders).insertOne({ code: 'A', status: 'OPEN' }));
    expect(error).toMatchObject({ code: 'DATA_TIMEOUT', status: 503, retryable: true, outcomeUnknown: true });
    expect(error.message).toMatch(/write outcome is unknown/);
  });
});

describe('bootstrap', () => {
  it('ensures every declaration in one batch, once', async () => {
    const mock = mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/collections/c-orders/records:count': ok({ count: 1 }), '/uns/collections/c-lines/records:count': ok({ count: 2 }) });
    const data = client(mock);
    await Promise.all([data.collection(orders).countDocuments(), data.collection('lines').countDocuments(), data.collection(orders).countDocuments()]);
    const calls = mock.calls(ENSURE);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ collections: [compileCollection(orders), compileCollection(lines)] });
    expect((calls[0].body.collections as { indexes: unknown }[])[0].indexes).toEqual([{ path: 'code', unique: true }]);
    expect(calls[0].headers[SUBJECT_HEADER]).toBeUndefined();
  });

  it('does not cache a failed ensure', async () => {
    const mock = mockUns({
      [ENSURE]: [fail(503, 'TEMPORARILY_UNAVAILABLE', null, 'hosted App is not ready'), BOTH_UNCHANGED],
      '/uns/collections/c-orders/records:count': ok({ count: 0 }),
    });
    const data = client(mock);
    await expect(data.collection(orders).countDocuments()).rejects.toThrow(/hosted App is not ready/);
    expect(await data.collection(orders).countDocuments()).toBe(0);
    expect(mock.calls(ENSURE)).toHaveLength(2);
  });

  it('writes seeds only for collections ensure created', async () => {
    const mock = mockUns({
      [ENSURE]: ensured({ alias: 'orders', collectionId: 'c-orders', status: 'created' }, { alias: 'lines', collectionId: 'c-lines', status: 'widened' }),
      '/uns/collections/c-orders/records:insertMany': ok({ insertedCount: 2, insertedIds: { 0: 'o-1', 1: 'o-2' }, status: 'committed', replayed: false }),
    });
    await client(mock).ensure();
    const inserts = mock.sent.filter(entry => entry.path.endsWith('records:insertMany'));
    expect(inserts).toHaveLength(1);
    const { idempotencyKey, ...body } = inserts[0].body;
    expect(String(idempotencyKey)).toMatch(/^seed-[0-9a-f]{40}-0$/);
    expect(body).toEqual({
      collectionId: 'c-orders',
      documents: [
        { id: 'o-1', data: { code: 'A-1', status: 'OPEN' } },
        { id: 'o-2', data: { code: 'A-2', status: 'DONE' } },
      ],
      ordered: true,
      atomic: true,
    });
  });

  it('writes large seeds in 200-document chunks and retries a chunk with the same key', async () => {
    const big = defineCollection({
      alias: 'big',
      schema: z.object({ n: z.number().int() }),
      seed: Array.from({ length: 450 }, (_, n) => ({ _id: `b-${n}`, n })),
    });
    const mock = mockUns({
      [ENSURE]: ensured({ alias: 'big', collectionId: 'c-big', status: 'created' }),
      '/uns/collections/c-big/records:insertMany': [
        ok({ insertedCount: 200 }),
        fail(503, 'TEMPORARILY_UNAVAILABLE'),
        ok({ insertedCount: 200, replayed: true }),
        ok({ insertedCount: 50 }),
      ],
    });
    const errors: unknown[] = [];
    await client(mock, { collections: [big], logger: { ...silent, error: (...args: unknown[]) => errors.push(args) } }).ensure();
    const chunks = mock.calls('/uns/collections/c-big/records:insertMany');
    expect(chunks.map(entry => (entry.body.documents as unknown[]).length)).toEqual([200, 200, 200, 50]);
    expect(chunks.map(entry => String(entry.body.idempotencyKey).split('-').pop())).toEqual(['0', '1', '1', '2']);
    expect((chunks[3].body.documents as { id: string }[])[0].id).toBe('b-400');
    expect(errors).toHaveLength(0);
  });

  it('logs a failed seed and keeps serving', async () => {
    const errors: unknown[] = [];
    const mock = mockUns({
      [ENSURE]: ensured({ alias: 'orders', collectionId: 'c-orders', status: 'created' }, { alias: 'lines', collectionId: 'c-lines', status: 'created' }),
      '/uns/collections/c-orders/records:insertMany': fail(409, 'DUPLICATE_KEY'),
      '/uns/collections/c-lines/records:insertMany': ok({ insertedCount: 1, insertedIds: { 0: 'l-1' } }),
    });
    const state = await client(mock, { logger: { ...silent, error: (...args: unknown[]) => errors.push(args) } }).ensure();
    expect(state.collectionIds.get('lines')).toBe('c-lines');
    expect(errors).toHaveLength(1);
    expect(mock.calls('/uns/collections/c-lines/records:insertMany')).toHaveLength(1);
  });

  it('throws SCHEMA_CONFLICT in preview', async () => {
    const conflict = fail(409, 'SCHEMA_CONFLICT', { conflicts: [{ alias: 'orders', collectionId: 'c-orders', path: 'qty', reason: 'integer vs string' }] });
    const error = await failed(client(mockUns({ [ENSURE]: conflict })).ensure());
    expect(error.code).toBe('SCHEMA_CONFLICT');
    expect(error.message).toMatch(/orders\.qty/);
  });

  it('serves conflicting collections by their existing ID in a deployment', async () => {
    const logged: unknown[] = [];
    const mock = mockUns({
      [ENSURE]: [
        fail(409, 'SCHEMA_CONFLICT', { conflicts: [{ alias: 'orders', collectionId: 'c-orders', path: 'qty', reason: 'type' }] }),
        ensured({ alias: 'lines', collectionId: 'c-lines' }),
      ],
      '/uns/collections/c-orders/records:count': ok({ count: 3 }),
    });
    const data = client(mock, { environment: 'deployed', logger: { ...silent, error: (...args: unknown[]) => logged.push(args) } });
    expect(await data.collection(orders).countDocuments()).toBe(3);
    const [first, retry] = mock.calls(ENSURE);
    expect(first.body.collections as unknown[]).toHaveLength(2);
    expect((retry.body.collections as { alias: string }[]).map(item => item.alias)).toEqual(['lines']);
    expect(logged).toHaveLength(1);
  });

  it('keeps removing conflicting declarations until the rest ensures', async () => {
    const mock = mockUns({
      [ENSURE]: [
        fail(409, 'SCHEMA_CONFLICT', { conflicts: [{ alias: 'orders', collectionId: 'c-orders', path: 'qty' }] }),
        fail(409, 'SCHEMA_CONFLICT', { conflicts: [{ alias: 'lines', collectionId: 'c-lines', path: 'sku' }] }),
      ],
    });
    const state = await client(mock, { environment: 'deployed' }).ensure();
    expect(mock.calls(ENSURE)).toHaveLength(2);
    expect(state.collectionIds.get('orders')).toBe('c-orders');
    expect(state.collectionIds.get('lines')).toBe('c-lines');

    const opaque = mockUns({ [ENSURE]: fail(409, 'SCHEMA_CONFLICT', { conflicts: [] }) });
    expect((await failed(client(opaque, { environment: 'deployed' }).ensure())).code).toBe('SCHEMA_CONFLICT');
  });

  it('explains JOIN_UNSUPPORTED and DATA_RULE_FIELD conflicts like any SCHEMA_CONFLICT', async () => {
    const conflict = fail(409, 'SCHEMA_CONFLICT', {
      conflicts: [
        { alias: 'orders', collectionId: 'c-orders', path: '', reason: 'JOIN_UNSUPPORTED' },
        { alias: 'lines', collectionId: 'c-lines', path: 'sku', reason: 'DATA_RULE_FIELD' },
      ],
    });
    const error = await failed(client(mockUns({ [ENSURE]: conflict })).ensure());
    expect(error.code).toBe('SCHEMA_CONFLICT');
    expect(error.message).toMatch(/orders: JOIN_UNSUPPORTED — .*schema:replace/);
    expect(error.message).toMatch(/lines\.sku: DATA_RULE_FIELD — .*data rule/);

    const state = await client(mockUns({ [ENSURE]: conflict }), { environment: 'deployed' }).ensure();
    expect(state.collectionIds.get('orders')).toBe('c-orders');
    expect(state.collectionIds.get('lines')).toBe('c-lines');
    expect(state.conflicts.map(entry => entry.reason)).toEqual(['JOIN_UNSUPPORTED', 'DATA_RULE_FIELD']);
  });

  it('logs ANNOTATION_NOT_APPLIED as a schema:replace hint without failing Preview', async () => {
    const logged = { info: [] as string[], warn: [] as string[] };
    const logger = { ...silent, info: (message: string) => logged.info.push(message), warn: (message: string) => logged.warn.push(message) };
    const mock = mockUns({
      [ENSURE]: ensured(
        {
          alias: 'orders',
          collectionId: 'c-orders',
          ignored: [
            { path: '', reason: 'ANNOTATION_NOT_APPLIED', message: 'Collection description is only set at creation' },
            { path: 'status', reason: 'ANNOTATION_NOT_APPLIED' },
            { path: 'legacy', reason: 'UNDECLARED_PROPERTY' },
          ],
        },
        { alias: 'lines', collectionId: 'c-lines' },
      ),
    });
    const state = await client(mock, { logger }).ensure();
    expect(state.collectionIds.get('orders')).toBe('c-orders');
    expect(logged.warn).toHaveLength(1);
    expect(logged.warn[0]).toMatch(/not applied: orders, orders\.status\. Apply them with schema:replace .*compileCollection/);
    expect(logged.info).toHaveLength(1);
    expect(logged.info[0]).toMatch(/legacy UNDECLARED_PROPERTY/);
    expect(logged.info[0]).not.toMatch(/status/);
  });

  it('sends the same annotations for an unchanged declaration, so ensure reports no annotation difference', () => {
    const declare = () =>
      defineCollection({
        alias: 'tickets',
        description: 'Support tickets',
        schema: z
          .object({
            title: z.string().describe('Short summary'),
            severity: z.enum(['LOW', 'HIGH']).describe('Triage level').optional(),
            steps: z.array(z.object({ note: z.string().describe('步骤说明') })),
          })
          .describe('One ticket'),
      });
    const first = compileCollection(declare());
    expect(compileCollection(declare())).toEqual(first);
    expect(first.description).toBe('Support tickets');
    expect(first.recordSchema.description).toBe('One ticket');
    expect(first.recordSchema.properties?.title.description).toBe('Short summary');
    expect(first.recordSchema.properties?.severity.description).toBe('Triage level');
    expect(first.recordSchema.properties?.steps.items?.properties?.note.description).toBe('步骤说明');
    // No description declared → none sent; ensure only flags a non-empty declared description that differs.
    expect('description' in compileCollection(defineCollection({ alias: 'bare', schema: z.object({ a: z.string() }) }))).toBe(false);
  });

  it('throws ensure warnings in preview after seeding, and only logs them when deployed', async () => {
    const reply = ensured(
      { alias: 'orders', collectionId: 'c-orders', status: 'created' },
      { alias: 'lines', collectionId: 'c-lines', warnings: [{ code: 'REQUIRED_NOT_ENFORCED', path: 'sku' }] },
    );
    const seeds = { '/uns/collections/c-orders/records:insertMany': ok({ insertedCount: 2 }) };

    const preview = mockUns({ [ENSURE]: reply, ...seeds });
    expect((await failed(client(preview).ensure())).code).toBe('SCHEMA_WARNINGS');
    expect(preview.calls('/uns/collections/c-orders/records:insertMany')).toHaveLength(1);

    const warnings: unknown[] = [];
    const deployed = mockUns({ [ENSURE]: reply, ...seeds });
    const state = await client(deployed, { environment: 'deployed', logger: { ...silent, warn: (...args: unknown[]) => warnings.push(args) } }).ensure();
    expect(state.collectionIds.get('lines')).toBe('c-lines');
    expect(warnings).toHaveLength(1);
  });

  it('surfaces APP_GRANT_REVOKED without retrying grants', async () => {
    const mock = mockUns({ [ENSURE]: fail(403, 'APP_GRANT_REVOKED') });
    expect(await failed(client(mock).collection(orders).countDocuments())).toMatchObject({ code: 'APP_GRANT_REVOKED', status: 403 });
  });

  it('rejects more than 64 declarations', () => {
    const many = Array.from({ length: 65 }, (_, n) => defineCollection({ alias: `c${n}`, schema: z.object({ a: z.string() }) }));
    expect(() => client(mockUns({}), { collections: many })).toThrow(/at most 64 collections/);
  });

  it('rejects undeclared collections', () => {
    const data = client(mockUns({}));
    expect(() => data.collection('ghost')).toThrow(/not declared/);
    const stray = defineCollection({ alias: 'stray', schema: z.object({ a: z.string() }) });
    expect(() => data.collection(stray)).toThrow(/missing from the `collections`/);
  });
});

describe('stale collection recovery', () => {
  const RECREATED = ensured({ alias: 'orders', collectionId: 'c-orders-2', status: 'created' }, { alias: 'lines', collectionId: 'c-lines' });
  const count = (n: number) => ok({ count: n });

  it('re-ensures, reseeds and retries once when the App grant went with the collection', async () => {
    const mock = mockUns({
      [ENSURE]: [BOTH_UNCHANGED, RECREATED],
      '/uns/collections/c-orders/records:count': NOT_GRANTED,
      '/uns/collections/c-orders-2/records:insertMany': ok({ insertedCount: 2 }),
      '/uns/collections/c-orders-2/records:count': count(2),
    });
    expect(await client(mock).collection(orders).countDocuments()).toBe(2);
    expect(mock.calls(ENSURE)).toHaveLength(2);
    expect(mock.calls('/uns/collections/c-orders/records:count')).toHaveLength(1);
    expect(mock.calls('/uns/collections/c-orders-2/records:insertMany'), 'created again → seeded again').toHaveLength(1);
  });

  it('recovers from COLLECTION_NOT_FOUND (404 or 403), including $lookup targets and transactions', async () => {
    const moved = ensured({ alias: 'orders', collectionId: 'c-orders' }, { alias: 'lines', collectionId: 'c-lines-2' });
    const mock = mockUns({
      [ENSURE]: [BOTH_UNCHANGED, moved],
      '/uns/collections/c-orders/records:aggregate': sent => {
        const lookup = (sent.body.pipeline as { $lookup?: { collectionId: string } }[])[0].$lookup!;
        return lookup.collectionId === 'c-lines' ? GONE : ok({ items: [{ n: 1 }], pageInfo: { hasMore: false } });
      },
    });
    const rows = await client(mock)
      .collection(orders)
      .aggregate([{ $lookup: { from: lines, localField: '_id', foreignField: 'orderId', as: 'lines' } }, { $group: { _id: null, n: { $sum: 1 } } }])
      .toArray();
    expect(rows).toEqual([{ n: 1 }]);
    expect(mock.calls(ENSURE)).toHaveLength(2);

    const tx = mockUns({
      [ENSURE]: [BOTH_UNCHANGED, moved],
      '/uns/records:transact': sent =>
        (sent.body.items as { collectionId: string }[])[0].collectionId === 'c-lines-2'
          ? ok({ status: 'committed', replayed: false, results: [] })
          : // Not granted and gone: UNS answers 403 with COLLECTION_NOT_FOUND.
            fault(403, 'FORBIDDEN', 'App has no permission for this Collection operation', { reason: 'COLLECTION_NOT_FOUND', collectionId: 'c-lines' }),
    });
    await client(tx).transact([{ opId: 'a', action: 'record.create', collection: lines, data: { orderId: 'o-1', sku: 'S' } }]);
    expect(tx.calls('/uns/records:transact').map(sent => (sent.body.items as { collectionId: string }[])[0].collectionId)).toEqual(['c-lines', 'c-lines-2']);
  });

  it('does not retry when the rebuild changes no collection ID, nor without a stale-collection data.reason', async () => {
    const unchanged = mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/collections/c-orders/records:count': NOT_GRANTED });
    expect((await failed(client(unchanged).collection(orders).countDocuments())).status).toBe(403);
    expect(unchanged.calls(ENSURE)).toHaveLength(2);
    expect(unchanged.calls('/uns/collections/c-orders/records:count')).toHaveLength(1);

    for (const reply of [
      fault(404, 'NOT_FOUND', 'record filter matched no records'),
      fault(403, 'FORBIDDEN', 'employee cannot access this Record'),
      fault(403, 'APP_GRANT_REVOKED', "an administrator revoked this App's grant for the Collection", { reason: 'GRANT_REVOKED' }),
      NO_UNS_DELETE,
      // The message text alone never triggers a rebuild.
      fault(403, 'FORBIDDEN', 'App has no permission for this Collection operation'),
    ]) {
      const mock = mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/collections/c-orders/records:count': reply });
      await failed(client(mock).collection(orders).countDocuments());
      expect(mock.calls(ENSURE), JSON.stringify(reply.body.data)).toHaveLength(1);
    }
  });

  it('surfaces APP_GRANT_REVOKED from the rebuild', async () => {
    const mock = mockUns({
      [ENSURE]: [BOTH_UNCHANGED, fail(403, 'APP_GRANT_REVOKED')],
      '/uns/collections/c-orders/records:count': NOT_GRANTED,
    });
    expect((await failed(client(mock).collection(orders).countDocuments())).code).toBe('APP_GRANT_REVOKED');
  });

  it('shares one rebuild between concurrent failures and rebuilds at most once per interval', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
    const mock = mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/collections/c-orders/records:count': NOT_GRANTED });
    const handle = client(mock).collection(orders);
    await Promise.allSettled([handle.countDocuments(), handle.countDocuments(), handle.countDocuments()]);
    expect(mock.calls(ENSURE), 'one initial ensure plus one shared rebuild').toHaveLength(2);
    await failed(handle.countDocuments());
    expect(mock.calls(ENSURE), 'inside the interval: no rebuild').toHaveLength(2);
    vi.setSystemTime(1_000_000 + REBUILD_INTERVAL_MS);
    await failed(handle.countDocuments());
    expect(mock.calls(ENSURE)).toHaveLength(3);
  });

  it('rebuilds but does not retry a call that continues an old cursor', async () => {
    const mock = mockUns({
      [ENSURE]: [BOTH_UNCHANGED, RECREATED],
      '/uns/collections/c-orders/records:find': [
        ok({ items: [{ id: 'o-1', collectionId: 'c-orders', data: { code: 'A', status: 'OPEN' }, revision: 1 }], pageInfo: { hasMore: true, nextCursor: 'k1' } }),
        NOT_GRANTED,
      ],
      '/uns/collections/c-orders-2/records:insertMany': ok({ insertedCount: 2 }),
    });
    expect((await failed(client(mock).collection(orders).find({}, { limit: 400 }).toArray())).status).toBe(403);
    expect(mock.calls(ENSURE)).toHaveLength(2);
    expect(mock.calls('/uns/collections/c-orders-2/records:find')).toHaveLength(0);
  });
});

describe('collection operations', () => {
  const record = (id: string, data: Record<string, unknown>) => ({ id, collectionId: 'c-orders', data, revision: 2, createdAt: 1, updatedAt: 5, sourceId: null, sourceTime: null });

  it('pages find() through nextCursor and flattens records', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:find': [
        ok({ items: [record('o-1', { code: 'A', status: 'OPEN' }), record('o-2', { code: 'B', status: 'OPEN' })], pageInfo: { hasMore: true, nextCursor: 'n1' } }),
        ok({ items: [record('o-3', { code: 'C', status: 'OPEN' })], pageInfo: { hasMore: false, nextCursor: null } }),
      ],
    });
    const docs = await client(mock).collection(orders).find({ status: 'OPEN' }).sort({ code: -1 }).limit(3).toArray();
    expect(docs[0]).toEqual({ code: 'A', status: 'OPEN', _id: 'o-1', _meta: { revision: 2, createdAt: 1, updatedAt: 5 } });
    expect(docs.map(doc => doc._id)).toEqual(['o-1', 'o-2', 'o-3']);
    const [first, second] = mock.calls('/uns/collections/c-orders/records:find');
    expect(first.body).toEqual({ collectionId: 'c-orders', filter: { status: 'OPEN' }, sort: [['code', -1]], limit: 3 });
    expect(second.body).toEqual({ collectionId: 'c-orders', filter: { status: 'OPEN' }, sort: [['code', -1]], limit: 3, cursor: 'n1' });
  });

  it('stops at the limit and returns findOne as null when empty', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:find': ok({ items: [], pageInfo: { hasMore: false } }),
    });
    expect(await client(mock).collection(orders).findOne({ _id: 'missing' })).toBeNull();
    expect(mock.calls('/uns/collections/c-orders/records:find')[0].body.limit).toBe(1);
  });

  it('serves numbered pages through aggregate offset paging plus count', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:aggregate': ok({ items: [{ _id: 'o-3', code: 'C', status: 'OPEN', _meta: { revision: 1 } }], pageInfo: { hasMore: false } }),
      '/uns/collections/c-orders/records:count': ok({ count: 21 }),
    });
    const page = await client(mock).collection(orders).findPage({ status: 'OPEN' }, { sort: { '_meta.createdAt': -1 }, page: 2, pageSize: 20 });
    expect(page.total).toBe(21);
    expect(page.items[0]._id).toBe('o-3');
    expect(mock.calls('/uns/collections/c-orders/records:aggregate')[0].body).toEqual({
      collectionId: 'c-orders',
      pipeline: [{ $match: { status: 'OPEN' } }, { $sort: [['_meta.createdAt', -1]] }],
      page: { mode: 'offset', page: 2, size: 20 },
    });
  });

  it('collects every distinct page', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:distinct': [ok({ values: ['OPEN'], pageInfo: { hasMore: true, nextPage: 2 } }), ok({ values: ['DONE'], pageInfo: { hasMore: false } })],
    });
    expect(await client(mock).collection(orders).distinct('status')).toEqual(['OPEN', 'DONE']);
  });

  it('pages transformed aggregates by offset and converts $sort objects', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:aggregate': [
        ok({ items: [{ _id: 'OPEN', total: 2 }], pageInfo: { mode: 'offset', hasMore: true, nextPage: 2, nextCursor: null } }),
        ok({ items: [{ _id: 'DONE', total: 1 }], pageInfo: { mode: 'offset', hasMore: false, nextPage: null, nextCursor: null } }),
      ],
    });
    const rows = await client(mock).collection(orders).aggregate([{ $group: { _id: '$status', total: { $sum: 1 } } }, { $sort: { total: -1 } }]).toArray();
    expect(rows).toEqual([{ _id: 'OPEN', total: 2 }, { _id: 'DONE', total: 1 }]);
    const [first, second] = mock.calls('/uns/collections/c-orders/records:aggregate');
    expect(first.body.pipeline).toEqual([{ $group: { _id: '$status', total: { $sum: 1 } } }, { $sort: [['total', -1]] }]);
    expect(first.body.page).toEqual({ mode: 'offset', page: 1, size: 200 });
    expect(second.body.page).toEqual({ mode: 'offset', page: 2, size: 200 });
  });

  it('pages $match/$sort-only aggregates by cursor and sends no page for a final $count', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:aggregate': [
        ok({ items: [{ _id: 'o-1' }], pageInfo: { mode: 'cursor', hasMore: true, nextCursor: 'k1', nextPage: null } }),
        ok({ items: [{ _id: 'o-2' }], pageInfo: { mode: 'cursor', hasMore: false, nextCursor: null, nextPage: null } }),
        ok({ items: [{ open: 2 }], pageInfo: { hasMore: false } }),
      ],
    });
    const handle = client(mock).collection(orders);
    const rows = await handle.aggregate([{ $match: { status: 'OPEN' } }, { $sort: { code: 1 } }]).toArray();
    expect(rows.map(row => row._id)).toEqual(['o-1', 'o-2']);
    expect(await handle.aggregate([{ $match: { status: 'OPEN' } }, { $count: 'open' }]).toArray()).toEqual([{ open: 2 }]);
    const [first, second, total] = mock.calls('/uns/collections/c-orders/records:aggregate');
    expect(first.body.page).toEqual({ mode: 'cursor', size: 200 });
    expect(second.body.page).toEqual({ mode: 'cursor', size: 200, cursor: 'k1' });
    expect(total.body.page).toBeUndefined();
  });

  it('resolves $lookup.from to the declared collection ID', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:aggregate': ok({ items: [], pageInfo: { hasMore: false } }),
    });
    const handle = client(mock).collection(orders);
    await handle
      .aggregate([{ $lookup: { from: lines, localField: '_id', foreignField: 'orderId', as: 'lines', pipeline: [{ $sort: { sku: 1 } }] } }])
      .toArray();
    expect(mock.calls('/uns/collections/c-orders/records:aggregate')[0].body.pipeline).toEqual([
      { $lookup: { collectionId: 'c-lines', localField: '_id', foreignField: 'orderId', as: 'lines', pipeline: [{ $sort: [['sku', 1]] }] } },
    ]);
    await expect(handle.aggregate([{ $lookup: { from: 'ghost', localField: 'a', foreignField: 'b', as: 'c' } }]).toArray()).rejects.toThrow(/not declared/);
  });

  it('validates before writing and sends UNS write bodies', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records': ok({ insertedId: 'o-9', status: 'committed', replayed: false }),
      '/uns/collections/c-orders/records:updateOne': ok({ matchedCount: 1, modifiedCount: 1, status: 'committed', replayed: false }),
      '/uns/collections/c-orders/records:findOneAndUpdate': ok({ value: record('o-9', { code: 'A', status: 'DONE' }), status: 'committed', replayed: false }),
    });
    const handle = client(mock).collection(orders);
    await expect(handle.insertOne({ code: 'A', status: 'OPEN', colour: 'red' } as never)).rejects.toBeInstanceOf(z.ZodError);
    expect(mock.calls('/uns/collections/c-orders/records')).toHaveLength(0);

    expect(await handle.insertOne({ _id: 'o-9', code: 'A', status: 'OPEN' })).toEqual({ insertedId: 'o-9' });
    expect(mock.calls('/uns/collections/c-orders/records')[0].body).toEqual({ collectionId: 'c-orders', id: 'o-9', data: { code: 'A', status: 'OPEN' } });

    await handle.updateOne({ _id: 'o-9' }, { $set: { status: 'DONE' }, $inc: { qty: 1 } }, { expectedRevision: 2 });
    expect(mock.calls('/uns/collections/c-orders/records:updateOne')[0].body).toEqual({
      collectionId: 'c-orders',
      filter: { _id: 'o-9' },
      update: { $set: { status: 'DONE' }, $inc: { qty: 1 } },
      expectedRevision: 2,
    });

    const moved = await handle.findOneAndUpdate({ _id: 'o-9', status: 'OPEN' }, { $set: { status: 'DONE' } });
    expect(moved?.status).toBe('DONE');
    expect(mock.calls('/uns/collections/c-orders/records:findOneAndUpdate')[0].body.returnDocument).toBe('after');
  });

  it('runs updateMany and deleteMany non-atomically through resumeAfter', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:updateMany': [
        ok({ matchedCount: 2, modifiedCount: 2, hasMore: true, resumeAfter: 'r1' }),
        ok({ matchedCount: 1, modifiedCount: 1, hasMore: false }),
        ok({ matchedCount: 1, modifiedCount: 1, hasMore: false, writeErrors: [{ index: 1, code: 'SCHEMA_MISMATCH' }] }),
      ],
      '/uns/collections/c-orders/records:deleteMany': ok({ deletedCount: 4, hasMore: false }),
    });
    const handle = client(mock).collection(orders);
    expect(await handle.updateMany({ status: 'OPEN' }, { $set: { status: 'DONE' } })).toEqual({ matchedCount: 3, modifiedCount: 3 });
    const calls = mock.calls('/uns/collections/c-orders/records:updateMany');
    expect(calls[0].body.atomic).toBe(false);
    expect(calls[1].body.resumeAfter).toBe('r1');
    const partial = await failed(handle.updateMany({ status: 'OPEN' }, { $set: { status: 'DONE' } }));
    expect(partial.code).toBe('WRITE_ERRORS');
    expect(partial.message).toMatch(/already committed: matchedCount=1, modifiedCount=1/);
    expect(await handle.deleteMany({ status: 'DONE' })).toEqual({ deletedCount: 4 });
    expect(mock.calls('/uns/collections/c-orders/records:deleteMany')[0].body.atomic).toBe(false);
  });

  it('rejects atomic batches over 200 items before sending', async () => {
    const mock = mockUns({ [ENSURE]: BOTH_UNCHANGED });
    const data = client(mock);
    const docs = Array.from({ length: 201 }, (_, n) => ({ code: `C-${n}`, status: 'OPEN' as const }));
    const tooLarge = async (promise: Promise<unknown>) => {
      const error = await failed(promise);
      expect(error.code).toBe('BATCH_LIMIT_EXCEEDED');
      expect(error.message).toMatch(/chunks of 200/);
    };
    await tooLarge(data.collection(orders).insertMany(docs));
    await tooLarge(data.collection(orders).bulkWrite(docs.map(document => ({ insertOne: { document } }))));
    await tooLarge(data.transact(docs.map((document, n) => ({ opId: `c${n}`, action: 'record.create' as const, collection: orders, data: document }))));
    expect(mock.sent.filter(entry => entry.path !== ENSURE)).toHaveLength(0);
  });

  it('maps Mongo bulkWrite operations', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/collections/c-orders/records:bulkWrite': ok({ insertedCount: 1, matchedCount: 1, modifiedCount: 1, deletedCount: 1, upsertedCount: 0, insertedIds: { 0: 'o-5' }, upsertedIds: {} }),
    });
    const result = await client(mock).collection(orders).bulkWrite([
      { insertOne: { document: { _id: 'o-5', code: 'E', status: 'OPEN' } } },
      { updateOne: { filter: { _id: 'o-1' }, update: { $set: { status: 'DONE' } } } },
      { deleteOne: { filter: { _id: 'o-2' } } },
    ]);
    expect(result.insertedIds).toEqual({ 0: 'o-5' });
    expect(mock.calls('/uns/collections/c-orders/records:bulkWrite')[0].body.operations).toEqual([
      { insertOne: { id: 'o-5', data: { code: 'E', status: 'OPEN' } } },
      { updateOne: { filter: { _id: 'o-1' }, update: { $set: { status: 'DONE' } } } },
      { deleteOne: { filter: { _id: 'o-2' } } },
    ]);
  });

  it('runs transactions synchronously with resolved collection IDs', async () => {
    const mock = mockUns({
      [ENSURE]: BOTH_UNCHANGED,
      '/uns/records:transact': [
        ok({ status: 'committed', replayed: false, results: [{ opId: 'create', action: 'record.create', id: 'l-9', status: 'committed', document: record('l-9', { orderId: 'o-1', sku: 'S' }) }] }),
        ok({ status: 'failed', replayed: false, results: [{ opId: 'check', action: 'record.check', id: 'o-1', status: 'failed', error: { code: 'CHECK_FAILED' } }] }),
      ],
    });
    const data = client(mock);
    const result = await data.transact([
      { opId: 'check', action: 'record.check', collection: orders, filter: { _id: 'o-1', status: 'OPEN' } },
      { opId: 'create', action: 'record.create', collection: 'lines', id: 'l-9', data: { orderId: 'o-1', sku: 'S' }, dependsOn: ['check'] },
    ]);
    expect(result.results[0].document?._id).toBe('l-9');
    const body = mock.calls('/uns/records:transact')[0].body;
    expect(body.mode).toBe('sync');
    expect(body.items).toEqual([
      { opId: 'check', action: 'record.check', collectionId: 'c-orders', filter: { _id: 'o-1', status: 'OPEN' } },
      { opId: 'create', action: 'record.create', collectionId: 'c-lines', id: 'l-9', data: { orderId: 'o-1', sku: 'S' }, dependsOn: ['check'] },
    ]);
    const error = await failed(data.transact([{ opId: 'check', action: 'record.check', collection: orders, filter: { _id: 'o-1' } }]));
    expect(error.code).toBe('TRANSACTION_FAILED');
    expect(error.message).toMatch(/CHECK_FAILED/);
  });
});

describe('transaction step validation', () => {
  const data = () => client(mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/records:transact': ok({ status: 'committed', replayed: false, results: [] }) }));

  it('rejects _id in step data and points to id', async () => {
    const error = await data()
      .transact([{ opId: 'c', action: 'record.create', collection: orders, data: { _id: 'o-1', code: 'A', status: 'OPEN' } }])
      .then(() => undefined, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(z.ZodError);
    expect(String((error as Error).message)).toMatch(/with `id`/);
  });

  it('validates literal fields of a step with bindings and lets bound fields through', async () => {
    const step = (fields: Record<string, unknown>) => [
      { opId: 'read', action: 'record.read' as const, collection: orders, id: 'o-1' },
      {
        opId: 'line',
        action: 'record.create' as const,
        collection: lines,
        data: fields,
        bindings: [{ path: 'data.orderId', ref: 'read', resultPath: 'id' }],
        dependsOn: ['read'],
      },
    ];
    const handle = data();
    await handle.transact(step({ sku: 'S' }));
    await expect(handle.transact(step({ sku: 5 }))).rejects.toBeInstanceOf(z.ZodError);
    await expect(handle.transact(step({ sku: 'S', colour: 'red' }))).rejects.toThrow(/Unknown field/);
    await expect(handle.transact(step({}))).rejects.toBeInstanceOf(z.ZodError);
  });

  it('passes record.query count expectations through', async () => {
    const mock = mockUns({ [ENSURE]: BOTH_UNCHANGED, '/uns/records:transact': ok({ status: 'committed', replayed: false, results: [] }) });
    await client(mock).transact([
      { opId: 'q', action: 'record.query', collection: orders, query: { filter: { code: 'A' }, sort: { code: 1 }, expectCount: { min: 1, max: 1 } } },
    ]);
    expect((mock.calls('/uns/records:transact')[0].body.items as Record<string, unknown>[])[0].query).toEqual({
      filter: { code: 'A' },
      sort: [['code', 1]],
      expectCount: { min: 1, max: 1 },
    });
  });
});

describe('data subject', () => {
  const routes = () => ({
    [ENSURE]: BOTH_UNCHANGED,
    '/uns/collections/c-orders/records:count': ok({ count: 1 }),
    '/uns/collections/c-orders/records:insertMany': ok({ insertedCount: 0 }),
  });
  const subjectOf = (entry: Sent) => entry.headers[SUBJECT_HEADER];
  const request = (subject: string) => new Headers({ 'X-Tier0-App-Data-Subject': subject });

  it("forwards the request's subject to record calls but never to ensure", async () => {
    const mock = mockUns(routes());
    const data = client(mock);
    await runWithRequestContext(request('h.jwt-subject.s'), () => data.collection(orders).countDocuments());
    expect(subjectOf(mock.calls(ENSURE)[0])).toBeUndefined();
    expect(subjectOf(mock.calls('/uns/collections/c-orders/records:count')[0])).toBe('h.jwt-subject.s');
  });

  it('keeps the subject per request across concurrent async work', async () => {
    const mock = mockUns(routes());
    const data = client(mock);
    await data.ensure();
    await Promise.all(
      ['h.s-1.x', 'h.s-2.x', 'h.s-3.x'].map(subject =>
        runWithRequestContext(request(subject), async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          expect(currentDataSubject()).toBe(subject);
          return data.collection(orders).countDocuments({ by: subject });
        }),
      ),
    );
    for (const entry of mock.calls('/uns/collections/c-orders/records:count')) {
      expect(subjectOf(entry)).toBe((entry.body.filter as { by: string }).by);
    }
  });

  it('omits the subject outside requests, in runAsApp and for seeds', async () => {
    const mock = mockUns({ ...routes(), [ENSURE]: ensured({ alias: 'orders', collectionId: 'c-orders', status: 'created' }, { alias: 'lines', collectionId: 'c-lines' }) });
    const data = client(mock);
    await runWithRequestContext(request('h.jwt.s'), async () => {
      await data.collection(orders).countDocuments();
      await runAsApp(() => data.collection(orders).countDocuments());
    });
    await data.collection(orders).countDocuments();
    expect(mock.calls('/uns/collections/c-orders/records:count').map(subjectOf)).toEqual(['h.jwt.s', undefined, undefined]);
    expect(subjectOf(mock.calls('/uns/collections/c-orders/records:insertMany')[0])).toBeUndefined();
  });

  it('rejects a malformed subject before any record request', async () => {
    const mock = mockUns(routes());
    const data = client(mock);
    await data.ensure();
    await expect(runWithRequestContext(request('not a token'), () => data.collection(orders).countDocuments())).rejects.toThrow(/unsV2AppDataSubject/);
    expect(mock.calls('/uns/collections/c-orders/records:count')).toHaveLength(0);
  });
});
