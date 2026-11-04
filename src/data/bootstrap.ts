/**
 * First-access bootstrap: one batched `ensure` of every declared collection.
 *
 * - ensure only creates or widens; storage never narrows from here, so old
 *   and new code may cold-start in any order.
 * - The result is memoized per client, i.e. per server process; a client
 *   built from edited declarations ensures again.
 *   Failures are not memoized: a later call retries (an imported App may
 *   answer "hosted App is not ready").
 * - Validate seeds before ensure; newly created collections seed in atomic
 *   chunks of 200. Failure keeps in-memory progress and fails ensure; unknown
 *   or committed outcomes need verified recovery. A stable idempotency key
 *   alone does not prove safe replay. Seed writes never carry a data subject.
 * - Preview throws on SCHEMA_CONFLICT and warnings so the worker sees them;
 *   a deployment logs them and keeps serving with the IDs it has.
 * - Self-healing: a Preview reset hard-deletes collections, and a worker or
 *   admin may archive one, while this process still holds the old IDs. A
 *   record call that fails with `data.reason` COLLECTION_NOT_FOUND or
 *   COLLECTION_NOT_GRANTED drops the memo, ensures again (seeding what is created)
 *   and retries the call once, but only when the failed operation did not
 *   take effect and a collection ID actually
 *   changed. Rebuilds are limited to one per REBUILD_INTERVAL_MS per client;
 *   APP_GRANT_REVOKED is never retried (ensure itself reports it).
 * - `ignored` notes never fail a request. ensure never writes annotations, so
 *   an edited name, `.describe()` or collection description comes back as
 *   ANNOTATION_NOT_APPLIED; it is logged as a warning pointing at
 *   metadata:updateOne for names, or schema:replace for schema annotations.
 */
import { createHash } from 'node:crypto';
import type { DataCall } from './call.js';
import { assertNoWriteErrors, MAX_ATOMIC_ITEMS } from './collection.js';
import type { CollectionDefinition } from './define.js';
import { ACCESS_REASONS, DataError } from './error.js';
import { compileCollection, validateDocument, type CompiledCollection } from './schema.js';
import { DataPrincipalError } from './principal.js';

export type DataEnvironment = 'preview' | 'deployed';

export interface EnsureWarning {
  code: string;
  path?: string;
  message?: string;
}

export interface EnsureNote {
  path: string;
  reason?: string;
  message?: string;
}

export interface EnsureResult {
  alias: string;
  collectionId: string;
  revision: number;
  status: 'created' | 'unchanged' | 'widened';
  ignored?: EnsureNote[];
  warnings?: EnsureWarning[];
  indexStatus?: unknown[];
}

export interface EnsureConflict {
  alias: string;
  collectionId?: string;
  path?: string;
  reason?: string;
  current?: string;
  declared?: string;
}

export interface EnsureState {
  appId?: string;
  results: EnsureResult[];
  /** Lower-cased alias → collection ID. */
  collectionIds: Map<string, string>;
  /** Declarations that conflicted in a deployment (served with their existing ID, if any). */
  conflicts: EnsureConflict[];
}

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface BootstrapConfig {
  call: DataCall;
  collections: readonly CollectionDefinition[];
  environment: DataEnvironment;
  logger: Logger;
  /** Internal only: prepare a server-bound retry for this exact seed operation. */
  prepareSeedRecovery?: (operation: object) => Promise<void>;
}

const SEED_ATTEMPTS = 3;
/** Wait before replaying seed chunk attempt n+1: n × this. */
export const SEED_RETRY_MS = 1_000;

/** At most one self-healing rebuild per client in this window. */
export const REBUILD_INTERVAL_MS = 30_000;

/**
 * Whether a record call failed because the collection ID it used is gone or
 * no longer granted, by UNS's stable `data.reason` code. Archive and Preview
 * purge also remove the App grant, so most stale IDs answer
 * COLLECTION_NOT_GRANTED or COLLECTION_NOT_FOUND. APP_PERMISSION_MISSING (the
 * key lacks e.g. `uns.delete`) and APP_GRANT_REVOKED are not stale IDs.
 */
export function isStaleCollectionError(error: unknown): boolean {
  return (
    error instanceof DataError &&
    (error.execution === 'notStarted' || error.execution === 'rolledBack') &&
    (error.reason === ACCESS_REASONS.notGranted || error.reason === ACCESS_REASONS.notFound)
  );
}

function sameCollectionIds(a: EnsureState, b: EnsureState): boolean {
  if (a.collectionIds.size !== b.collectionIds.size) return false;
  for (const [alias, id] of a.collectionIds) {
    if (b.collectionIds.get(alias) !== id) return false;
  }
  return true;
}

/** Idempotency key of one seed chunk (UNS keys are at most 96 characters). */
function seedChunkKey(collectionId: string, chunk: number): string {
  return `seed-${createHash('sha256').update(collectionId).digest('hex').slice(0, 40)}-${chunk}`;
}

/** What to do about each SCHEMA_CONFLICT reason (CloudAppCollectionConflict.reason). */
const CONFLICT_HINTS: Record<string, string> = {
  TYPE_CONFLICT: "a field's type cannot change; use a new field name and backfill with updateMany",
  LIMIT_EXCEEDED: 'the joined schema exceeds a UNS limit (depth, properties, enum values or indexes); split the structure',
  OPEN_OBJECT: 'every object must be closed; declare it with z.object',
  ALIAS_IN_USE: 'the alias belongs to another collection; pick another alias',
  NAME_IN_USE: 'the business name belongs to another collection in this folder; pick another name and keep the stable alias',
  INVALID_INDEX: 'fix the index declaration',
  JOIN_UNSUPPORTED:
    'the stored schema holds a node the declaration cannot widen (e.g. enum values outside its range); repair it with schema:replace via the tier0 MCP',
  DATA_RULE_FIELD:
    'an employee data rule (ownerField / stateField) uses this field; keep it required with the same type, or ask a workspace admin to change the rule',
};

function describeConflicts(conflicts: EnsureConflict[]): string {
  return conflicts
    .map((conflict) => {
      const where = `${conflict.alias}${conflict.path ? `.${conflict.path}` : ''}`;
      const types = conflict.current || conflict.declared ? ` (stored ${conflict.current ?? '?'}, declared ${conflict.declared ?? '?'})` : '';
      const hint = conflict.reason && CONFLICT_HINTS[conflict.reason] ? ` — ${CONFLICT_HINTS[conflict.reason]}` : '';
      return `  - ${where}: ${conflict.reason ?? 'conflict'}${types}${hint}`;
    })
    .join('\n');
}

function notePath(alias: string, note: EnsureNote): string {
  return note.path ? `${alias}.${note.path}` : alias;
}

function describeWarnings(results: EnsureResult[]): string {
  return results
    .flatMap((result) =>
      (result.warnings ?? []).map(
        (warning) => `  - ${result.alias}${warning.path ? `.${warning.path}` : ''}: ${warning.code}${warning.message ? ` — ${warning.message}` : ''}`,
      ),
    )
    .join('\n');
}

export function createBootstrap(config: BootstrapConfig) {
  const { call, collections, environment, logger } = config;
  let pending: Promise<EnsureState> | null = null;
  let lastRebuild = Number.NEGATIVE_INFINITY;
  type SeedProgress = {
    alias: string;
    appId?: string;
    collectionId: string;
    chunks: { id?: string; data: Record<string, unknown> }[][];
    next: number;
    operation: object;
    unknown: boolean;
    committed: boolean;
    required: boolean;
    interrupted: boolean;
  };
  // In-memory only: a restart needs a durable server-side seed recovery contract.
  const pendingSeeds = new Map<string, SeedProgress>();

  async function requestEnsure(items: CompiledCollection[]) {
    // ensure is App-level work: it never carries the employee data subject.
    return call<{ appId?: string; results: EnsureResult[] }>('appCollectionsEnsure', { collections: items });
  }

  async function insertSeedChunk(progress: SeedProgress) {
    const { collectionId, next: chunk } = progress;
    const documents = progress.chunks[chunk];
    const idempotencyKey = seedChunkKey(collectionId, chunk);
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (progress.unknown || progress.required) {
          // This hook must ultimately bind the verified receipt scope to the
          // actual attempt. No real adapter exists yet; never guess a scope.
          if (!config.prepareSeedRecovery) throw new DataPrincipalError(progress.unknown ? { idempotencyKey } : undefined);
          await config.prepareSeedRecovery(progress.operation);
        }
        const result = await call<{ writeErrors?: Record<string, unknown>[] }>('recordBulkWrite', {
          collectionId,
          operations: documents.map(document => ({ insertOne: document })),
          ordered: true,
          atomic: true,
          idempotencyKey,
        }, { seedOperation: progress.operation });
        assertNoWriteErrors(result, 'seed');
        progress.unknown = false;
        progress.committed = false;
        return;
      } catch (error) {
        if (error instanceof DataError && error.outcomeUnknown) progress.unknown = true;
        if (error instanceof DataError && error.execution === 'committed') progress.committed = true;
        if (error instanceof DataPrincipalError && progress.unknown) throw new DataPrincipalError({ idempotencyKey });
        if (error instanceof DataPrincipalError && progress.committed) throw new DataError({
          message: 'The seed write reported a committed outcome; verified recovery is required.', status: 503,
          code: 'SEED_RECOVERY_REQUIRED', execution: 'committed', retry: { safe: false }, idempotencyKey,
        });
        // An unknown chunk is never resent without the verified recovery hook
        // above; a stable key alone does not establish the server receipt scope.
        if (!(error instanceof DataError) || !(error.outcomeUnknown || error.retry.safe) || attempt >= SEED_ATTEMPTS) {
          if (progress.unknown) throw new DataError({ message: 'The seed write outcome remains unknown.', status: 503,
            code: 'OUTCOME_UNKNOWN', execution: 'unknown', retry: { safe: false }, idempotencyKey });
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, SEED_RETRY_MS * attempt));
      }
    }
  }

  async function writeSeeds(results: EnsureResult[], prepared: Map<string, { id?: string; data: Record<string, unknown> }[]>, appId?: string) {
    // Register all created collections before sending: a later failure must not
    // erase chunks that the next ensure will report as unchanged.
    for (const result of results) {
      if (result.status !== 'created') continue;
      const definition = collections.find((candidate) => candidate.alias.toLowerCase() === result.alias.toLowerCase());
      const seed = definition?.seed;
      if (!definition || !seed || seed.length === 0) continue;
      const alias = result.alias.toLowerCase();
      if (pendingSeeds.has(alias)) continue;
      const documents = prepared.get(alias);
      if (!documents) throw new Error('Tier0 SDK: seed preparation is missing.');
      const chunks: SeedProgress['chunks'] = [];
      for (let start = 0; start < documents.length; start += MAX_ATOMIC_ITEMS) {
        chunks.push(documents.slice(start, start + MAX_ATOMIC_ITEMS));
      }
      pendingSeeds.set(alias, { alias: result.alias, appId, collectionId: result.collectionId, chunks, next: 0,
        operation: {}, unknown: false, committed: false, required: false, interrupted: false });
    }
    for (const [alias, progress] of pendingSeeds) {
      const result = results.find(item => item.alias.toLowerCase() === alias);
      if (!result || result.collectionId !== progress.collectionId ||
        (progress.interrupted && (!progress.appId || !appId || appId !== progress.appId))) {
        const idempotencyKey = seedChunkKey(progress.collectionId, progress.next);
        throw new DataError({ message: 'An unfinished seed belongs to a different or unavailable collection.', status: 503,
          code: progress.unknown ? 'OUTCOME_UNKNOWN' : 'SEED_RECOVERY_REQUIRED',
          execution: progress.unknown ? 'unknown' : progress.committed ? 'committed' : 'notStarted', retry: { safe: false }, idempotencyKey });
      }
      try {
        while (progress.next < progress.chunks.length) {
          await insertSeedChunk(progress);
          progress.next++;
          progress.required = false;
          progress.interrupted = false;
          // The next chunk has its own principal and receipt scope.
          progress.operation = {};
        }
        pendingSeeds.delete(alias);
        logger.info(`[data] seeded ${progress.chunks.reduce((n, items) => n + items.length, 0)} record(s) into "${progress.alias}"`);
      } catch (error) {
        progress.interrupted = true;
        // Local credential gaps after no-effect attempts can be resumed in
        // this client. All other failures retain the chunk for verified recovery.
        const noEffect = error instanceof DataError && (
          error.execution === 'notStarted' && error.attempts === 0 ||
          error.code === 'DATA_NOT_CONFIGURED' && (error.execution === 'notStarted' || error.execution === 'rolledBack')
        );
        progress.required ||= !noEffect;
        throw error;
      }
    }
  }

  async function run(payload: CompiledCollection[]): Promise<EnsureState> {
    // Validate and snapshot seed documents before collection creation. If
    // validation fails, the server must not first commit a collection whose
    // next ensure would otherwise say unchanged with no seed progress.
    const prepared = new Map<string, { id?: string; data: Record<string, unknown> }[]>();
    for (const definition of collections) {
      if (!definition.seed?.length) continue;
      prepared.set(definition.alias.toLowerCase(), definition.seed.map((document) => {
        const { id, data } = validateDocument(definition, document as Record<string, unknown>);
        return { id, data };
      }));
    }
    const conflicts: EnsureConflict[] = [];
    let remaining = payload;
    let response: { appId?: string; results: EnsureResult[] } = { results: [] };
    while (remaining.length > 0) {
      try {
        response = await requestEnsure(remaining);
        break;
      } catch (error) {
        if (!(error instanceof DataError) || error.code !== 'SCHEMA_CONFLICT') throw error;
        const reported = Array.isArray(error.details.conflicts) ? (error.details.conflicts as EnsureConflict[]) : [];
        const summary = describeConflicts(reported);
        if (environment === 'preview') {
          throw new DataError({
            message:
              `The collection declarations conflict with the stored collection schemas; nothing was changed:\n${summary}`,
            status: 409,
            code: 'SCHEMA_CONFLICT',
            upstreamStatus: error.upstreamStatus,
            requestId: error.requestId,
            execution: error.execution,
            attempts: error.attempts,
            details: error.details,
          });
        }
        // A deployment keeps serving: drop the conflicting declarations (the
        // whole batch was rejected) and ensure the rest again.
        const conflicting = new Set(reported.map((conflict) => conflict.alias.toLowerCase()));
        const next = remaining.filter((item) => !conflicting.has(item.alias.toLowerCase()));
        if (next.length === remaining.length) throw error;
        logger.error(`[data] ensure: declarations conflict with stored schemas; serving them unchanged:\n${summary}`);
        conflicts.push(...reported);
        remaining = next;
      }
    }

    const results = response.results ?? [];
    const collectionIds = new Map<string, string>();
    for (const conflict of conflicts) {
      if (conflict.collectionId) collectionIds.set(conflict.alias.toLowerCase(), conflict.collectionId);
    }
    for (const result of results) {
      collectionIds.set(result.alias.toLowerCase(), result.collectionId);
      const notes = result.ignored ?? [];
      const annotations = notes.filter((note) => note.reason === 'ANNOTATION_NOT_APPLIED');
      const directories = notes.filter((note) => note.reason === 'DIRECTORY_PATH_NOT_APPLIED');
      const wider = notes.filter((note) => note.reason !== 'ANNOTATION_NOT_APPLIED' && note.reason !== 'DIRECTORY_PATH_NOT_APPLIED');
      if (directories.length > 0) {
        logger.warn(
          `[data] ensure keeps existing collection locations; not applied: ${directories.map((note) => notePath(result.alias, note)).join(', ')}. ` +
            'A directoryPath declaration only places a new collection. Move existing collections explicitly through metadata operations when authorized.',
        );
      }
      if (wider.length > 0) {
        logger.info(
          `[data] "${result.alias}" storage is wider than this declaration (or has retired parts); ignored: ` +
            wider.map((note) => `${note.path || '(root)'} ${note.reason ?? ''}`.trim()).join(', '),
        );
      }
      if (annotations.length > 0) {
        // A hint, not an error: storage keeps its annotations and serves as before.
        logger.warn(
          `[data] ensure does not change stored names/titles/descriptions; not applied: ${annotations.map((note) => notePath(result.alias, note)).join(', ')}. ` +
            `Rename with metadata:updateOne via the tier0 MCP; apply schema annotations with schema:replace, selecting alias, recordSchema, indexes and description from compileCollection(...).`,
        );
      }
    }

    await writeSeeds(results, prepared, response.appId);

    const warnings = describeWarnings(results);
    if (warnings) {
      if (environment === 'preview') {
        throw new DataError({
          message:
            `Collections were ensured with warnings:\n${warnings}\n` +
            'REQUIRED_NOT_ENFORCED: make the field optional again or narrow explicitly with schema:replace via the tier0 MCP. ' +
            'INDEX_BUILD_FAILED: fix the duplicate or invalid data, then the next ensure retries the index.',
          status: 500,
          code: 'SCHEMA_WARNINGS',
          // ensure did apply; only the warnings fail the Preview request.
          execution: 'committed',
          details: { results },
        });
      }
      logger.warn(`[data] ensure warnings:\n${warnings}`);
    }

    return { appId: response.appId, results, collectionIds, conflicts };
  }

  /** Ensures every declaration once per client; a failure is forgotten so the next call retries. */
  function ensure(): Promise<EnsureState> {
    pending ??= Promise.resolve()
      .then(() => run(collections.map(compileCollection)))
      .catch((error) => {
        pending = null;
        // Even an unrelated ensure failure cannot establish the outcome of a
        // previously dispatched seed chunk.
        const seeds = [...pendingSeeds.values()];
        const unresolved = seeds.find(seed => seed.unknown) ?? seeds.find(seed => seed.committed);
        if (unresolved) {
          const idempotencyKey = seedChunkKey(unresolved.collectionId, unresolved.next);
          if (unresolved.committed && !unresolved.unknown) throw new DataError({
            message: 'The seed write reported a committed outcome; verified recovery is required.', status: 503,
            code: 'SEED_RECOVERY_REQUIRED', execution: 'committed', retry: { safe: false }, idempotencyKey,
          });
          if (error instanceof DataPrincipalError) throw new DataPrincipalError({ idempotencyKey });
          throw new DataError({ message: 'The seed write outcome remains unknown.', status: 503,
            code: 'OUTCOME_UNKNOWN', execution: 'unknown', retry: { safe: false }, idempotencyKey });
        }
        throw error;
      });
    return pending;
  }

  /**
   * Re-ensures after `before` turned out stale. Joins a rebuild already in
   * flight; otherwise rebuilds at most once per REBUILD_INTERVAL_MS. Resolves
   * whether any collection ID changed; ensure errors (APP_GRANT_REVOKED, …)
   * propagate.
   */
  async function rebuild(before: EnsureState, cause: DataError): Promise<boolean> {
    // Only owned IDs can be recovered by ensure; shared references must keep their original error.
    const failedId = cause.details.collectionId;
    if (typeof failedId === 'string' && ![...before.collectionIds.values()].includes(failedId)) return false;
    const current = ensure();
    const latest = await current;
    if (latest !== before) return !sameCollectionIds(before, latest);
    if (pending !== current) return !sameCollectionIds(before, await ensure());
    const now = Date.now();
    if (now - lastRebuild < REBUILD_INTERVAL_MS) return false;
    lastRebuild = now;
    logger.warn(`[data] a collection ID is no longer usable (${cause.code}: ${cause.message}); ensuring collections again`);
    pending = null;
    return !sameCollectionIds(before, await ensure());
  }

  /**
   * Runs one data call; when it fails on a stale collection ID, rebuilds and
   * runs it once more if an ID changed. `retry: false` (calls continuing a
   * cursor or resumeAfter token of the old collection) only rebuilds.
   */
  async function recover<R>(fn: () => Promise<R>, options: { retry?: boolean } = {}): Promise<R> {
    const before = await ensure();
    try {
      return await fn();
    } catch (error) {
      if (!isStaleCollectionError(error)) throw error;
      const changed = await rebuild(before, error as DataError);
      if (!changed || options.retry === false) throw error;
      return fn();
    }
  }

  async function resolve(definition: CollectionDefinition): Promise<string> {
    const state = await ensure();
    const id = state.collectionIds.get(definition.alias.toLowerCase());
    if (!id) {
      throw new DataError({
        message: `Collection "${definition.alias}" is unavailable: ensure did not return it (see the server log).`,
        status: 503,
        code: 'COLLECTION_UNAVAILABLE',
      });
    }
    return id;
  }

  return { ensure, resolve, recover, rebuild };
}
