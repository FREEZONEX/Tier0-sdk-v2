/**
 * Data client factory: collection handles, cross-collection transactions and
 * the shared bootstrap. An App builds one client per process from its
 * collection declarations; tests build their own with a mock `fetch`.
 */
import type { z } from 'zod';
import { snapshotClientConfig, type ClientConfig } from '../openapi/client.js';
import { getEnvVar } from '../runtime-env.js';
import { createBootstrap, isStaleCollectionError, type DataEnvironment, type EnsureState, type Logger } from './bootstrap.js';
import { createDataTransport, type DataRequestObserver } from './call.js';
import { MAX_ATOMIC_ITEMS, Collection, toDoc, type BatchQuery, type UnsRecord, type WithMeta } from './collection.js';
import { MAX_TRANSACTION_ITEMS, MAX_RESULT_BINDINGS, assertTransactionCapacity, readTransactionLimits, type TransactionLimits } from './transaction-limits.js';
import { currentSignal } from './context.js';
import {
  ALIAS_PATTERN,
  collectionLabel,
  isCollectionDefinition,
  isCollectionIdReference,
  isExternalAliasReference,
  MAX_COLLECTIONS,
  type CollectionAliasReference,
  type CollectionDefinition,
  type CollectionReference,
  type CollectionSchema,
  type CollectionTarget,
} from './define.js';
import { createExternalContext, type ExternalContextSnapshot } from './external-context.js';
import { createSubscribe, type ResolvedSubscription, type SubscribeOptions, type SubscriptionEvent } from './subscribe.js';
import { parseUnsV2Fault, UNS_V2_SUBSCRIBE_MAX_COLLECTIONS, UnsV2Error } from '../uns-v2/client.js';
import { DataError, externalCollectionUnboundError, toDataError } from './error.js';
import { createStepDataValidator, validateUpdate } from './schema.js';
import { toSortPairs, type Filter, type Sort } from './sort.js';
import { assertIndexesReady } from './index-readiness.js';
import type { AppContext } from '../uns-v2/generated.js';

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
  bindings?: {
    /** Update scalars use update/$set/<field> or update/$setOnInsert/<field>; JSON Pointer-escape the field token. */
    path: string;
    ref: string;
    resultPath: string;
    /** Only transactionTime: bind the database timestamp as a UTC ISO string with millisecond precision. */
    format?: 'iso8601';
    /** For create/replace/sample.append data string fields: JSON Pointer to an existing scalar placeholder inside the encoded JSON object. */
    jsonPath?: string;
  }[];
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
  /** Successful record.check/read: database transaction start time in Unix milliseconds. */
  transactionTime?: number;
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

export interface TransactOptions {
  dryRun?: boolean;
  idempotencyKey?: string;
  /** Index preflight before submission and after collection recovery. Declared collections only; not a metadata lock. */
  requireIndexesReady?: boolean;
  /** False surfaces an unknown commit even when the server advertises safe receipt replay. */
  retryUnknown?: boolean;
}

/** Nonempty named reads for `data.queryBatch`, names matching `[A-Za-z0-9_.-]{1,64}`. */
export type BatchQueries = Record<string, BatchQuery<unknown>>;
export type BatchResults<Q extends BatchQueries> = { [K in keyof Q]: Q[K] extends BatchQuery<infer R> ? R : never };
export type SettledBatchResults<Q extends BatchQueries> = {
  [K in keyof Q]: Q[K] extends BatchQuery<infer R> ? { ok: true; value: R } | { ok: false; error: DataError } : never;
};

/** Zero means no fixed query-count limit; request and per-query budgets still apply. */
export const MAX_BATCH_QUERIES = 0;
const QUERY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** Data client state is bound to one static host and credential for its lifetime. */
export interface DataClientConfig extends Omit<ClientConfig, 'getApiKey' | 'apiKeyProvider'> {
  /** Dynamic credentials are unsupported while bootstrap and subscriptions share client state. */
  getApiKey?: never;
  apiKeyProvider?: never;
  collections?: readonly CollectionDefinition[];
  /** Defaults to "deployed" when NODE_ENV is production, otherwise "preview". */
  environment?: DataEnvironment;
  logger?: Logger;
  /** Optional metadata for completed data calls (including bootstrap), excluding subscription streams. */
  onRequest?: DataRequestObserver;
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
   * up to the negotiated server limit (legacy servers: 200 steps; client ceiling:
   * 50,000). Steps can depend on each other (`dependsOn`) and bind
   * earlier results (`bindings`). This is not a Mongo session: everything is
   * sent at once.
   */
  transact(steps: readonly TransactStep[], options?: TransactOptions): Promise<TransactResult>;
  /** Fresh effective synchronous transaction limits; older servers fall back to 200 steps. */
  getTransactionLimits(): Promise<TransactionLimits>;
  /**
   * Committed record changes of declared collections (all by default), as
   * one async iterable that reconnects and resumes by itself; see
   * `SubscribeOptions`. Events carry identities only. Open one per server
   * process and fan it out to browsers with `createChangeRelay`.
   */
  subscribe(options?: SubscribeOptions): AsyncIterable<SubscriptionEvent>;
  /**
   * Nonempty named reads of collections in one request, answered from one
   * snapshot: what a page shows (a list page with its total, counters, a
   * lookup by ID) in one round trip. Build each read with
   * `collection.query.*`; results come back under the same names.
   *
   * A read UNS refuses on its own (invalid filter, no grant) rejects the
   * whole call with its DataError; with `{ settle: true }` every result is
   * `{ ok, value }` or `{ ok: false, error }` instead. Statement and request
   * timeouts and a query exceeding its response budget fail the whole call,
   * including when settle is true.
   */
  queryBatch<Q extends BatchQueries>(queries: Q): Promise<BatchResults<Q>>;
  queryBatch<Q extends BatchQueries>(queries: Q, options: { settle: true }): Promise<SettledBatchResults<Q>>;
  /** Ensures every declaration now (normally lazy on first access). */
  ensure(): Promise<EnsureState>;
  /**
   * Resolves a declared collection, declared alias, external `{ alias }` reference,
   * or existing `{ collectionId }` reference to its current physical UNS collection ID.
   * Use for time-series (`client.uns.sample*`) calls instead of hard-coding IDs.
   * `{ refresh: true }` performs a rate-limited (30 s) `/uns/app/context` refresh for external aliases.
   */
  resolveCollectionId(target: CollectionTarget | string, options?: { refresh?: boolean }): Promise<string>;
  /**
   * Checks fresh App-context states for every declared index (or selected
   * declarations), rejecting missing/building/failed constraints. ensure alone
   * does not imply readiness. This is a point-in-time check, not a transaction
   * lock or an automatic write gate; it does not change seed/bootstrap behavior.
   */
  assertIndexesReady(collections?: readonly CollectionDefinition[]): Promise<void>;
}

export function createDataClient(config: DataClientConfig): DataClient {
  const snapshot = snapshotClientConfig(config, ['environment', 'collections', 'logger', 'onRequest']);
  if (Object.hasOwn(snapshot, 'apiKeyProvider')) {
    throw new TypeError('Tier0 SDK: apiKeyProvider is not supported by createDataClient.');
  }
  if (Object.hasOwn(snapshot, 'getApiKey')) {
    throw new TypeError('Tier0 SDK: getApiKey is not supported by createDataClient.');
  }
  // Never let bootstrap state, retries or SSE reconnect under a later identity or host.
  const fixed = {
    ...snapshot,
    apiKey: Object.hasOwn(snapshot, 'apiKey') ? snapshot.apiKey : getEnvVar('TIER0_API_KEY'),
    apiHost: snapshot.apiHost ?? snapshot.getApiHost?.() ?? getEnvVar('TIER0_API_HOST') ?? '',
  };
  const { call, openStream } = createDataTransport(fixed);
  const environment = snapshot.environment ?? (getEnvVar('NODE_ENV') === 'production' ? 'deployed' : 'preview');
  const declared = [...(snapshot.collections ?? [])];
  if (declared.length > MAX_COLLECTIONS) {
    throw new Error(`An App declares at most ${MAX_COLLECTIONS} collections; got ${declared.length}.`);
  }
  const seen = new Set<string>();
  for (const definition of declared) {
    const key = definition.alias.toLowerCase();
    if (seen.has(key)) throw new Error(`Collection alias "${definition.alias}" is declared twice (aliases are case-insensitive).`);
    seen.add(key);
  }

  // Ensure and seed writes pass no signal: they are shared by every request, and the one that triggers them must not cancel them.
  const logger = snapshot.logger ?? console;
  const bootstrap = createBootstrap({ call, collections: declared, environment, logger });
  const externalContext = createExternalContext({ call, ownedAliases: seen, logger });
  const referencedExternalAliases = new Set<string>();

  async function resolveTarget(target: CollectionTarget | string, options?: { refresh?: boolean }): Promise<string> {
    const definition = lookup(target);
    if (isCollectionIdReference(definition)) return definition.collectionId;
    if (isCollectionDefinition(definition)) return bootstrap.resolve(definition);
    return externalContext.resolve(definition.alias, options);
  }

  async function recover<R>(
    fn: () => Promise<R>,
    options: { collections: readonly CollectionTarget[]; retry?: boolean },
  ): Promise<R> {
    const ownedTargets = options.collections.filter(isCollectionDefinition);
    const externalTargets = options.collections.filter(isExternalAliasReference);
    if (ownedTargets.length === 0 && externalTargets.length === 0) return fn();
    const beforeEnsure = ownedTargets.length > 0 ? await bootstrap.ensure() : undefined;
    const beforeExternal = externalTargets.length > 0 ? await externalContext.load() : undefined;
    try {
      return await fn();
    } catch (error) {
      if (!isStaleCollectionError(error)) throw error;
      const cause = error as DataError;
      let changed = false;
      if (beforeEnsure) {
        if (await bootstrap.rebuild(beforeEnsure, cause)) changed = true;
      }
      if (beforeExternal) {
        const outcome = await externalContext.recoverTargets(beforeExternal, externalTargets, cause);
        if (outcome.unboundAlias !== undefined) {
          throw externalCollectionUnboundError(outcome.unboundAlias, cause);
        }
        if (outcome.changed) changed = true;
      }
      if (!changed || options.retry === false) throw error;
      return fn();
    }
  }

  const runtime = {
    call,
    resolve: (target: CollectionTarget | string) => resolveTarget(target),
    lookup,
    recover,
    signal: currentSignal,
    assertIndexesReady: (target: CollectionTarget, collectionId: string) => {
      const definition = lookup(target);
      if (!isCollectionDefinition(definition)) throw new TypeError('Index readiness requires a declared collection.');
      return assertIndexesReady(call, bootstrap.ensure, [definition], currentSignal(), new Map([[definition.alias.toLowerCase(), collectionId]]));
    },
  };
  const handles = new WeakMap<CollectionTarget, Collection<object>>();

  function lookup(target: CollectionTarget | string): CollectionTarget {
    if (typeof target === 'string') {
      const found = declared.find((definition) => definition.alias.toLowerCase() === target.toLowerCase());
      if (!found) throw new Error(`Collection "${target}" is not declared in this data client's collections.`);
      return found;
    }
    if (isCollectionIdReference(target)) {
      if ('alias' in target && (target as { alias?: unknown }).alias !== undefined) {
        throw new TypeError('A collection reference must set either collectionId or alias, not both.');
      }
      if (typeof target.collectionId !== 'string' || !target.collectionId || target.collectionId.trim() !== target.collectionId) {
        throw new TypeError('An existing collection reference needs a nonempty collectionId without surrounding whitespace.');
      }
      return target;
    }
    if (isCollectionDefinition(target)) {
      if (!declared.includes(target)) {
        throw new Error(`Collection "${target.alias}" is declared but missing from the \`collections\` passed to createDataClient.`);
      }
      return target;
    }
    if (typeof target.alias !== 'string' || !ALIAS_PATTERN.test(target.alias)) {
      throw new TypeError(
        `External collection alias "${String(target.alias)}" must match ${ALIAS_PATTERN} (letters, digits, "_" or "-", starting with a letter).`,
      );
    }
    const key = target.alias.toLowerCase();
    if (seen.has(key)) {
      throw new TypeError(
        `External collection alias "${target.alias}" conflicts with a declared collection of this data client (aliases are case-insensitive); pass the declared CollectionDefinition instead.`,
      );
    }
    referencedExternalAliases.add(key);
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
    options: TransactOptions = {},
  ): Promise<TransactResult> {
    assertTransactionCapacity(steps.length, MAX_TRANSACTION_ITEMS);
    for (const step of steps) {
      if ((step.bindings?.length ?? 0) > MAX_RESULT_BINDINGS) throw new DataError({ code: 'BATCH_LIMIT_EXCEEDED', status: 400,
        execution: 'notStarted', opId: step.opId,
        message: `Transaction step ${step.opId} exceeds ${MAX_RESULT_BINDINGS} result bindings. No transaction was sent.`,
        details: { requestedBindings: step.bindings!.length, maxBindings: MAX_RESULT_BINDINGS } });
      for (const binding of step.bindings ?? []) {
        if (binding.jsonPath !== undefined && (typeof binding.jsonPath !== 'string' || !binding.jsonPath.startsWith('/') ||
          !binding.path.startsWith('data.') || !['record.create', 'record.replace', 'sample.append'].includes(step.action))) {
          throw new TypeError('JSON string bindings require a data field and a JSON Pointer on create/replace/sample.append.');
        }
        if (binding.format !== undefined && (binding.format !== 'iso8601' || binding.resultPath !== 'transactionTime')) {
          throw new TypeError('Binding format iso8601 requires resultPath transactionTime.');
        }
      }
    }
    if (options.requireIndexesReady && steps.some(step => !isCollectionDefinition(lookup(step.collection)))) {
      throw new TypeError('Transaction index readiness requires declared collections, not external or existing-ID references.');
    }
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

  async function sendTransaction(steps: readonly TransactStep[], options: TransactOptions) {
    // Capacity and index checks share one snapshot per attempt. Recovery starts
    // here again and reads fresh context; nothing is cached across transactions.
    let context: Promise<AppContext> | undefined;
    const readContext = () => context ??= call<AppContext>('dataAppContext', {}, { signal: currentSignal() });
    let maxBodyBytes: number | undefined;
    if (steps.length > MAX_ATOMIC_ITEMS) {
      const limits = await readTransactionLimits(call, bootstrap.ensure, currentSignal(), readContext);
      assertTransactionCapacity(steps.length, limits.maxItems);
      maxBodyBytes = limits.maxBodyBytes;
    }
    // Resolve each target once per attempt. Recovery rebuilds this map so no
    // collection identity survives a reset; all resolutions start together.
    const definitions = steps.map(step => lookup(step.collection));
    const collectionIds = new Map(await Promise.all([...new Set(definitions)].map(async definition =>
      [definition, await runtime.resolve(definition)] as const)));
    const validateData = createStepDataValidator();
    const items = steps.map(({ collection: target, sort, query, ...step }, index) => {
      void target;
      const definition = definitions[index];
      const item: Record<string, unknown> = { ...step, collectionId: collectionIds.get(definition)! };
      if (sort) item.sort = toSortPairs(sort);
      if (query) item.query = { ...query, ...(query.sort ? { sort: toSortPairs(query.sort) } : {}) };
      if (step.data) {
        // Fields bound to earlier results are filled by UNS at commit; everything literal validates now.
        const bound = (step.bindings ?? []).flatMap((binding) => (binding.path.startsWith('data.') ? [binding.path.slice(5).split('.')[0]] : []));
        item.data = validateData(definition, step.data, bound);
      }
      if (step.update) item.update = validateUpdate(definition, step.update, (step.bindings ?? []).map(binding => binding.path));
      return item;
    });
    if (options.requireIndexesReady) {
      const definitions = [...new Set(steps.map(step => lookup(step.collection) as CollectionDefinition))];
      // Bind the check to the exact IDs about to be sent, even if another call
      // rebuilt the client's bootstrap while these items were being resolved.
      const expectedIds = new Map<string, string>();
      for (const [index, step] of steps.entries()) {
        const alias = (lookup(step.collection) as CollectionDefinition).alias.toLowerCase();
        const id = String(items[index].collectionId);
        if (expectedIds.has(alias) && expectedIds.get(alias) !== id) throw new DataError({
          code: 'COLLECTION_UNAVAILABLE', status: 503, execution: 'notStarted',
          message: 'A collection changed while preparing the transaction; no transaction was sent.',
        });
        expectedIds.set(alias, id);
      }
      await assertIndexesReady(call, bootstrap.ensure, definitions, currentSignal(), expectedIds, readContext);
    }
    const body = {
      items,
      mode: 'sync',
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    };
    return call<{ status: string; results?: (Omit<TransactResultItem, 'document'> & { document?: UnsRecord })[] }>(
      'recordTransactionExecute', body,
      { signal: currentSignal(), retryUnknown: options.retryUnknown, maxBodyBytes },
    );
  }

  async function queryBatch<Q extends BatchQueries>(queries: Q, options: { settle?: boolean } = {}) {
    const names = Object.keys(queries);
    if (names.length < 1) {
      throw new TypeError('data.queryBatch requires at least one query.');
    }
    const bad = names.find((name) => !QUERY_NAME.test(name));
    if (bad !== undefined) throw new TypeError(`data.queryBatch query name "${bad}" must match ${QUERY_NAME}.`);
    const collections = [...new Set(names.flatMap((name) => [
      lookup(queries[name].collection),
      ...(queries[name].references ?? []).map(lookup),
    ]))];
    // Items resolve their collection IDs inside the recovered call, so a retry uses fresh IDs.
    const { results } = await runtime.recover(async () => {
      const items = await Promise.all(names.map(async (name) => ({
        id: name,
        collectionId: await runtime.resolve(queries[name].collection),
        ...(await queries[name].prepare()),
      })));
      return call<{ results: Record<string, { ok: true; data: unknown } | { ok: false; error: unknown }> }>(
        'recordQueryBatch', { queries: items }, { signal: currentSignal() });
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

  const emptyEnsureState: EnsureState = { results: [], collectionIds: new Map<string, string>(), conflicts: [] };

  const subscribe = createSubscribe({
    openStream,
    validate(options) {
      const explicit = options.collections !== undefined;
      if (explicit) {
        const definitions = [...new Set(options.collections!.map(lookup))];
        if (definitions.length < 1 || definitions.length > UNS_V2_SUBSCRIBE_MAX_COLLECTIONS) {
          throw new TypeError(`data.subscribe watches 1–${UNS_V2_SUBSCRIBE_MAX_COLLECTIONS} collections; got ${definitions.length}.`);
        }
        if (options.recordIds !== undefined && definitions.length !== 1) {
          throw new TypeError('data.subscribe takes 1–100 recordIds, of exactly one collection.');
        }
        return { explicit: true };
      }
      const externalEnabled = options.includeExternal === true || referencedExternalAliases.size > 0;
      if (!externalEnabled && (declared.length < 1 || declared.length > UNS_V2_SUBSCRIBE_MAX_COLLECTIONS)) {
        throw new TypeError(`data.subscribe watches 1–${UNS_V2_SUBSCRIBE_MAX_COLLECTIONS} collections; got ${declared.length}.`);
      }
      if (externalEnabled && declared.length > UNS_V2_SUBSCRIBE_MAX_COLLECTIONS) {
        throw new TypeError(`data.subscribe watches 1–${UNS_V2_SUBSCRIBE_MAX_COLLECTIONS} collections; got ${declared.length}.`);
      }
      if (!externalEnabled && options.recordIds !== undefined && declared.length !== 1) {
        throw new TypeError('data.subscribe takes 1–100 recordIds, of exactly one collection.');
      }
      return { explicit: false };
    },
    async prepare({ collections: explicitList, includeExternal }) {
      const aliases = new Map<string, string>();
      if (explicitList !== undefined) {
        const targets = [...new Set(explicitList.map(lookup))];
        const ownedTargets = targets.filter(isCollectionDefinition);
        const externalTargets = targets.filter(isExternalAliasReference);
        const state = ownedTargets.length > 0 ? await bootstrap.ensure() : emptyEnsureState;
        const externalSnapshot = externalTargets.length > 0 ? await externalContext.load() : undefined;
        for (const target of targets) {
          const id = await resolveTarget(target);
          aliases.set(id, collectionLabel(target));
        }
        return { state, externalSnapshot, aliases, targets, hasExternal: externalTargets.length > 0 };
      }
      const state = declared.length > 0 ? await bootstrap.ensure() : emptyEnsureState;
      const targets: CollectionTarget[] = [...declared];
      for (const definition of declared) {
        const id = await bootstrap.resolve(definition);
        aliases.set(id, collectionLabel(definition));
      }
      const externalEnabled = includeExternal === true || referencedExternalAliases.size > 0;
      let externalSnapshot: ExternalContextSnapshot | undefined;
      if (externalEnabled) {
        externalSnapshot = await externalContext.load();
        const readable = externalContext.listReadable(
          externalSnapshot,
          includeExternal === true ? undefined : referencedExternalAliases,
        );
        for (const binding of readable) {
          if (aliases.size >= UNS_V2_SUBSCRIBE_MAX_COLLECTIONS) break;
          if (!aliases.has(binding.collectionId)) {
            aliases.set(binding.collectionId, binding.alias);
            targets.push({ alias: binding.alias });
          }
        }
      }
      return { state, externalSnapshot, aliases, targets, hasExternal: externalEnabled };
    },
    async recover(resolved: ResolvedSubscription, cause: DataError, { explicit }) {
      const ownedTargets = resolved.targets.filter(isCollectionDefinition);
      const externalTargets = resolved.targets.filter(isExternalAliasReference);
      let ownedChanged = false;
      let externalChanged = false;
      if (ownedTargets.length > 0) {
        ownedChanged = await bootstrap.rebuild(resolved.state, cause);
      }
      if (resolved.hasExternal && resolved.externalSnapshot) {
        if (explicit && externalTargets.length > 0) {
          const outcome = await externalContext.recoverTargets(resolved.externalSnapshot, externalTargets, cause);
          if (outcome.unboundAlias !== undefined) {
            throw externalCollectionUnboundError(outcome.unboundAlias, cause);
          }
          externalChanged = outcome.changed;
        } else {
          const failedId = typeof cause.details.collectionId === 'string' ? cause.details.collectionId : undefined;
          const ownedIds = new Set(resolved.state.collectionIds.values());
          if (!failedId || !ownedIds.has(failedId)) {
            const after = await externalContext.refresh(resolved.externalSnapshot, `${cause.code}: ${cause.reason ?? cause.message}`);
            const beforeExternalIds = [...resolved.aliases.keys()].filter((id) => !ownedIds.has(id));
            const nextBindings = externalContext.listReadable(after, undefined);
            const nextExternalIds = new Set(nextBindings.map((item) => item.collectionId));
            const revokedOrRebound =
              beforeExternalIds.some((id) => !nextExternalIds.has(id)) ||
              externalTargets.some((target: CollectionAliasReference) => {
                const key = target.alias.toLowerCase();
                return resolved.externalSnapshot!.byAlias.get(key)?.collectionId !== after.byAlias.get(key)?.collectionId;
              });
            if (revokedOrRebound) externalChanged = true;
          }
        }
      }
      if (ownedChanged) return { changed: true, reason: 'COLLECTION_RECREATED' };
      if (externalChanged) return { changed: true, reason: 'SCOPE_CHANGED' };
      return { changed: false, reason: 'COLLECTION_RECREATED' };
    },
    onScopeChanged(resolved) {
      if (resolved.hasExternal) externalContext.invalidate();
    },
  });

  return {
    collection: collection as DataClient['collection'],
    transact,
    queryBatch: queryBatch as DataClient['queryBatch'],
    subscribe,
    ensure: bootstrap.ensure,
    resolveCollectionId: (target, options) => resolveTarget(target, options),
    getTransactionLimits: () => readTransactionLimits(call, bootstrap.ensure, currentSignal()),
    assertIndexesReady: (definitions = declared) => {
      for (const definition of definitions) {
        if (!declared.includes(definition)) throw new TypeError('Index readiness requires declarations from this data client.');
      }
      return assertIndexesReady(call, bootstrap.ensure, definitions, currentSignal());
    },
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

