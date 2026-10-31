/**
 * Data client factory: collection handles, cross-collection transactions and
 * the shared bootstrap. An App builds one client per process from its
 * collection declarations; tests build their own with a mock `fetch`.
 */
import type { z } from 'zod';
import type { ClientConfig } from '../openapi/client.js';
import { getEnvVar } from '../runtime-env.js';
import { createBootstrap, type DataEnvironment, type EnsureState, type Logger } from './bootstrap.js';
import { createDataTransport } from './call.js';
import { assertAtomicBatch, Collection, toDoc, type BatchQuery, type UnsRecord, type WithMeta } from './collection.js';
import { currentDataSubject, currentSignal } from './context.js';
import { MAX_COLLECTIONS, type CollectionDefinition, type CollectionReference, type CollectionSchema, type CollectionTarget } from './define.js';
import { createSubscribe, type SubscribeOptions, type SubscriptionEvent } from './subscribe.js';
import { parseUnsV2Fault, UnsV2Error } from '../uns-v2/client.js';
import { DataError, toDataError } from './error.js';
import { validateStepData, validateUpdate } from './schema.js';
import { toSortPairs, type Filter, type Sort } from './sort.js';

export type TransactAction =
  | 'record.create'
  | 'record.check'
  | 'record.read'
  | 'record.update'
  | 'record.modify'
  | 'record.replace'
  | 'record.delete'
  | 'record.query';

/** One `recordTransactionExecute` item; `collection` is a declaration, declared alias, or existing-ID reference. */
export interface TransactStep {
  opId: string;
  action: TransactAction;
  collection: CollectionTarget | string;
  id?: string | { ref: string };
  filter?: Filter;
  data?: Record<string, unknown>;
  update?: Record<string, unknown>;
  upsert?: boolean;
  expectedRevision?: number;
  dependsOn?: string[];
  bindings?: { path: string; ref: string; resultPath: string }[];
  selection?: 'exactOne' | 'first';
  sort?: Sort;
  returnDocument?: 'before' | 'after';
  exists?: boolean;
  operations?: Record<string, unknown>[];
  conditions?: Filter[];
  /** `record.query`: rows to bind from; `expectCount` asserts the match count before `limit`. */
  query?: { filter?: Filter; sort?: Sort; limit?: number; expectCount?: { min?: number; max?: number } };
  arrayFilters?: Record<string, unknown>[];
}

export interface TransactResultItem {
  opId: string;
  action: string;
  id: string;
  status: string;
  collectionId?: string;
  revision?: number;
  /** Before/after snapshot when requested, as a flat document. */
  document?: WithMeta<Record<string, unknown>>;
  data?: unknown;
  query?: unknown;
  error?: unknown;
}

export interface TransactResult {
  status: string;
  results: TransactResultItem[];
}

/** Named reads for `data.queryBatch`: 1–20 entries, names matching `[A-Za-z0-9_.-]{1,64}`. */
export type BatchQueries = Record<string, BatchQuery<unknown>>;
export type BatchResults<Q extends BatchQueries> = { [K in keyof Q]: Q[K] extends BatchQuery<infer R> ? R : never };
export type SettledBatchResults<Q extends BatchQueries> = {
  [K in keyof Q]: Q[K] extends BatchQuery<infer R> ? { ok: true; value: R } | { ok: false; error: DataError } : never;
};

/** Contract limit of `records:queryBatch`. */
export const MAX_BATCH_QUERIES = 20;
const QUERY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** Credentials as for `createClient`; `transportTimeoutMs` (per attempt) defaults to 25 s here, see DEFAULT_DATA_TIMEOUT_MS. */
export interface DataClientConfig extends ClientConfig {
  collections?: readonly CollectionDefinition[];
  /** Defaults to "deployed" when NODE_ENV is production, otherwise "preview". */
  environment?: DataEnvironment;
  logger?: Logger;
}

export interface DataClient {
  /** Typed handle for a declaration listed in `collections`. */
  collection<C extends CollectionDefinition>(definition: C): Collection<z.output<C['schema']>, z.input<C['schema']>>;
  /** Existing collection, with optional local write validation. Never ensured, seeded, or granted by the SDK. */
  collection<S extends CollectionSchema>(reference: CollectionReference<S> & { schema: S }): Collection<z.output<S>, z.input<S>>;
  collection<T extends object = Record<string, unknown>>(reference: CollectionReference): Collection<T>;
  /** Handle by alias, typed by the caller. */
  collection<T extends object = Record<string, unknown>>(alias: string): Collection<T>;
  /**
   * Atomic multi-record, multi-collection write (`recordTransactionExecute`, sync),
   * at most 200 steps. Steps can depend on each other (`dependsOn`) and bind
   * earlier results (`bindings`). This is not a Mongo session: everything is
   * sent at once.
   */
  transact(steps: readonly TransactStep[], options?: { dryRun?: boolean; idempotencyKey?: string }): Promise<TransactResult>;
  /**
   * Committed record changes of declared collections (all by default), as
   * one async iterable that reconnects and resumes by itself; see
   * `SubscribeOptions`. Events carry identities only; changes in collections
   * with employee data rules arrive as collection-level notices unless
   * `restricted: "record"` is asked for. Open it inside a request to watch as
   * that employee, or in `runAsApp` for one App-wide stream a server fans out.
   */
  subscribe(options?: SubscribeOptions): AsyncIterable<SubscriptionEvent>;
  /**
   * Up to 20 reads of declared collections in one request, answered from one
   * snapshot: what a page shows (a list page with its total, counters, a
   * lookup by ID) in one round trip. Build each read with
   * `collection.query.*`; results come back under the same names.
   *
   * A read UNS refuses on its own (invalid filter, no grant) rejects the
   * whole call with its DataError; with `{ settle: true }` every result is
   * `{ ok, value }` or `{ ok: false, error }` instead. A statement timeout or
   * a batch over 2000 rows / 8 MiB always fails the whole call.
   */
  queryBatch<Q extends BatchQueries>(queries: Q): Promise<BatchResults<Q>>;
  queryBatch<Q extends BatchQueries>(queries: Q, options: { settle: true }): Promise<SettledBatchResults<Q>>;
  /** Ensures every declaration now (normally lazy on first access). */
  ensure(): Promise<EnsureState>;
}

export function createDataClient(config: DataClientConfig): DataClient {
  const { call, openStream } = createDataTransport(config);
  const environment = config.environment ?? (getEnvVar('NODE_ENV') === 'production' ? 'deployed' : 'preview');
  const declared = [...(config.collections ?? [])];
  if (declared.length > MAX_COLLECTIONS) {
    throw new Error(`An App declares at most ${MAX_COLLECTIONS} collections; got ${declared.length}.`);
  }
  const seen = new Set<string>();
  for (const definition of declared) {
    const key = definition.alias.toLowerCase();
    if (seen.has(key)) throw new Error(`Collection alias "${definition.alias}" is declared twice (aliases are case-insensitive).`);
    seen.add(key);
  }

  const bootstrap = createBootstrap({ call, collections: declared, environment, logger: config.logger ?? console });
  const runtime = {
    call,
    resolve: async (target: CollectionTarget | string) => {
      const definition = lookup(target);
      return 'collectionId' in definition ? definition.collectionId : bootstrap.resolve(definition);
    },
    recover: <R>(fn: () => Promise<R>, options: { collections: readonly CollectionTarget[]; retry?: boolean }) =>
      options.collections.every(target => 'collectionId' in target) ? fn() : bootstrap.recover(fn, options),
    subject: currentDataSubject,
    signal: currentSignal,
  };
  const handles = new Map<CollectionTarget, Collection<object>>();

  function lookup(target: CollectionTarget | string): CollectionTarget {
    if (typeof target === 'string') {
      const found = declared.find((definition) => definition.alias.toLowerCase() === target.toLowerCase());
      if (!found) throw new Error(`Collection "${target}" is not declared in this data client's collections.`);
      return found;
    }
    if ('collectionId' in target) {
      if (typeof target.collectionId !== 'string' || !target.collectionId || target.collectionId.trim() !== target.collectionId) {
        throw new TypeError('An existing collection reference needs a nonempty collectionId without surrounding whitespace.');
      }
      return target;
    }
    if (!declared.includes(target)) {
      throw new Error(`Collection "${target.alias}" is declared but missing from the \`collections\` passed to createDataClient.`);
    }
    return target;
  }

  function collection(target: CollectionTarget | string) {
    const definition = lookup(target);
    let handle = handles.get(definition);
    if (!handle) {
      handle = new Collection<object>(definition, runtime);
      handles.set(definition, handle);
    }
    return handle;
  }

  async function transact(
    steps: readonly TransactStep[],
    options: { dryRun?: boolean; idempotencyKey?: string } = {},
  ): Promise<TransactResult> {
    assertAtomicBatch('data.transact', steps.length);
    // Steps resolve their collection IDs inside the recovered call, so a retry uses fresh IDs.
    const result = await runtime.recover(() => sendTransaction(steps, options), { collections: steps.map(step => lookup(step.collection)) });
    const results = (result.results ?? []).map(({ document, ...item }) => ({
      ...item,
      ...(document ? { document: toDoc<Record<string, unknown>>(document) } : {}),
    }));
    const expected = options.dryRun ? 'validated' : 'committed';
    if (result.status !== expected) {
      const failed = results.filter((item) => item.error);
      // A sync transaction should only fail whole; map the rest of the Outcome statuses anyway.
      const execution = result.status === 'unknown' ? 'unknown' : result.status === 'partiallyCommitted' ? 'committed' : 'rolledBack';
      throw new DataError({
        message: `Transaction ${result.status}: ${failed.map((item) => `${item.opId} ${JSON.stringify(item.error)}`).join('; ') || 'no step committed'}`,
        status: execution === 'unknown' ? 503 : 409,
        code: 'TRANSACTION_FAILED',
        execution,
        attempts: 1,
        details: { status: result.status, results },
      });
    }
    return { status: result.status, results };
  }

  async function sendTransaction(steps: readonly TransactStep[], options: { dryRun?: boolean; idempotencyKey?: string }) {
    const items = await Promise.all(
      steps.map(async ({ collection: target, sort, query, ...step }) => {
        const definition = lookup(target);
        const item: Record<string, unknown> = { ...step, collectionId: await runtime.resolve(definition) };
        if (sort) item.sort = toSortPairs(sort);
        if (query) item.query = { ...query, ...(query.sort ? { sort: toSortPairs(query.sort) } : {}) };
        if (step.data) {
          // Fields bound to earlier results are filled by UNS at commit; everything literal validates now.
          const bound = (step.bindings ?? []).flatMap((binding) => (binding.path.startsWith('data.') ? [binding.path.slice(5).split('.')[0]] : []));
          item.data = validateStepData(definition, step.data, bound);
        }
        if (step.update) item.update = validateUpdate(definition, step.update);
        return item;
      }),
    );
    return call<{ status: string; results?: (Omit<TransactResultItem, 'document'> & { document?: UnsRecord })[] }>(
      'recordTransactionExecute',
      {
        items,
        mode: 'sync',
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      },
      { dataSubject: currentDataSubject(), signal: currentSignal() },
    );
  }

  async function queryBatch<Q extends BatchQueries>(queries: Q, options: { settle?: boolean } = {}) {
    const names = Object.keys(queries);
    if (names.length < 1 || names.length > MAX_BATCH_QUERIES) {
      throw new TypeError(`data.queryBatch takes 1–${MAX_BATCH_QUERIES} queries; got ${names.length}.`);
    }
    const bad = names.find((name) => !QUERY_NAME.test(name));
    if (bad !== undefined) throw new TypeError(`data.queryBatch query name "${bad}" must match ${QUERY_NAME}.`);
    const collections = names.map(name => lookup(queries[name].collection));
    // Items resolve their collection IDs inside the recovered call, so a retry uses fresh IDs.
    const { results } = await runtime.recover(async () => {
      const items = await Promise.all(names.map(async (name) => ({
        id: name,
        collectionId: await runtime.resolve(queries[name].collection),
        ...(await queries[name].prepare()),
      })));
      return call<{ results: Record<string, { ok: true; data: unknown } | { ok: false; error: unknown }> }>(
        'recordQueryBatch', { queries: items }, { dataSubject: currentDataSubject(), signal: currentSignal() });
    }, { collections });
    const settled = Object.fromEntries(names.map((name) => {
      const result = results[name];
      if (result?.ok === true) return [name, { ok: true, value: queries[name].parse(result.data) }];
      return [name, { ok: false, error: itemError(name, result?.error) }];
    })) as Record<string, { ok: true; value: unknown } | { ok: false; error: DataError }>;
    if (options.settle) return settled;
    const failed = names.find((name) => !settled[name].ok);
    if (failed !== undefined) throw (settled[failed] as { error: DataError }).error;
    return Object.fromEntries(names.map((name) => [name, (settled[name] as { value: unknown }).value]));
  }

  const subscribe = createSubscribe({
    openStream,
    ensure: (targets) => targets.some(target => !('collectionId' in target))
      ? bootstrap.ensure()
      : Promise.resolve({ results: [], collectionIds: new Map<string, string>(), conflicts: [] }),
    rebuild: (state, error, targets) => targets.every(target => 'collectionId' in target)
      ? Promise.resolve(false)
      : bootstrap.rebuild(state, error),
    resolve: runtime.resolve,
    lookup,
    declared,
    subject: currentDataSubject,
  });

  return {
    collection: collection as DataClient['collection'],
    transact,
    queryBatch: queryBatch as DataClient['queryBatch'],
    subscribe,
    ensure: bootstrap.ensure,
  };
}

/** Item errors carry no HTTP status of their own; it follows from the code. */
const ITEM_STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404 };

/** A queryBatch item's error as a DataError; its `upstreamStatus` is the status its code stands for. */
function itemError(name: string, value: unknown): DataError {
  const fault = parseUnsV2Fault(value);
  if (!fault) {
    return new DataError({
      message: `UNS answered query "${name}" of recordQueryBatch with an invalid result.`,
      status: 502,
      code: 'DATA_BAD_RESPONSE',
      upstreamStatus: 200,
      execution: 'rolledBack',
      attempts: 1,
    });
  }
  const error = new UnsV2Error(fault.reason ?? fault.code, {
    ...fault,
    // The items are reads: never an unknown outcome.
    execution: fault.execution === 'unknown' ? 'rolledBack' : fault.execution,
    queryId: fault.queryId ?? name,
    status: ITEM_STATUS[fault.code] ?? 400,
    operation: 'recordQueryBatch',
    data: { queryId: fault.queryId ?? name, details: fault.details ?? [] },
  });
  return toDataError(error);
}

