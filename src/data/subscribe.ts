/**
 * `data.subscribe`: committed record changes of declared collections over
 * UNS `records:subscribe` (server-sent events), as one async iterable that
 * outlives single connections.
 *
 * - Reconnects with `Last-Event-ID` when the stream ends, breaks, or stays
 *   silent for `idleTimeoutMs` (UNS sends a heartbeat every 15 s). A stream
 *   that dies young without a change backs off, so a server dropping every
 *   connection is not hammered.
 * - Failures marked `retry.safe` (429 over the subscription limit, 503,
 *   `APP_NOT_READY` from ensure …) are retried after `retry.afterMs` or a
 *   backoff of up to 30 s, without end; any other failure ends the
 *   iteration with that DataError.
 * - `reset` is passed on: `CURSOR_EXPIRED` (the position was cleaned up after
 *   24 h, cannot be decoded after a key rotation, or the tenant database
 *   moved) or `SCOPE_CHANGED` (access changed, e.g. a collection is no longer
 *   readable). The consumer reloads what it shows; the next connection
 *   starts from now, without a resume position. A collection recreated
 *   under a new ID (see bootstrap self-healing) yields `COLLECTION_RECREATED`.
 * - UNS delivers changes in write-transaction order, not commit order, so
 *   revisions of one record may arrive out of order. A non-delete change at
 *   or below the revision already passed on for its record is dropped; a
 *   `delete` always passes, a late one too, and forgets the record's
 *   revision, since a record written again under the same ID may start
 *   over at revision 1.
 * - Aborting `signal` or leaving the loop ends the iteration without error.
 * - The stream runs as the App: it sees every change of the collections
 *   granted to the App. A server opens one per process and fans it out to
 *   browsers with `createChangeRelay`, filtering per browser by what the App
 *   lets that visitor see.
 *
 * Events carry identities only, never record data; read the record to show it.
 */
import { isStaleCollectionError, type EnsureState } from './bootstrap.js';
import type { DataOpenStream } from './call.js';
import { assertEventId, UNS_V2_SUBSCRIBE_MAX_COLLECTIONS, UNS_V2_SUBSCRIBE_MAX_RECORD_IDS } from '../uns-v2/client.js';
import { collectionLabel, type CollectionTarget } from './define.js';
import { DataError } from './error.js';

/** Three missed 15 s heartbeats. */
export const SUBSCRIBE_IDLE_TIMEOUT_MS = 45_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;
/** After a reset, the next connection waits at least this long. */
const RESET_PAUSE_MS = 1_000;
/** A connection alive this long counts as healthy even without changes. */
const HEALTHY_CONNECTION_MS = 30_000;
/** Records whose last revision is remembered; beyond this the oldest is forgotten (a stale change may then pass, which only costs a reread). */
const SUBSCRIBE_SEEN_RECORDS_MAX = 10_000;

export interface SubscribeOptions {
  /** Declarations, aliases, or existing-ID references (at most 64); defaults to every declared collection. */
  collections?: readonly (CollectionTarget | string)[];
  /** Only changes of these record IDs (1–100, duplicates ignored), when exactly one collection is watched. */
  recordIds?: readonly string[];
  /** Resume after this event (e.g. a browser's `Last-Event-ID`). */
  lastEventId?: string;
  signal?: AbortSignal;
  /** Reconnect when nothing, not even a heartbeat, arrives for this long. */
  idleTimeoutMs?: number;
}

/**
 * One record committed (`record`) or deleted (`delete`) at `revision`. A
 * `record` change is never at or below a revision already passed on for the
 * same record since its last delete; a `delete` may be.
 */
export interface RecordChange {
  type: 'change';
  eventId: string;
  /** Alias of a declared collection, or the ID of an existing collection reference. */
  collection: string;
  collectionId: string;
  occurredAt: number;
  change: 'record' | 'delete';
  recordId: string;
  revision: number;
}

/** `reason`: `CURSOR_EXPIRED`, `SCOPE_CHANGED` (from UNS) or `COLLECTION_RECREATED`. */
export type SubscriptionEvent = RecordChange | { type: 'reset'; reason: string; message?: string };

export interface SubscribeRuntime {
  openStream: DataOpenStream;
  ensure(targets: readonly CollectionTarget[]): Promise<EnsureState>;
  rebuild(before: EnsureState, cause: DataError, targets: readonly CollectionTarget[]): Promise<boolean>;
  resolve(target: CollectionTarget): Promise<string>;
  lookup(target: CollectionTarget | string): CollectionTarget;
  declared: readonly CollectionTarget[];
}

function reconnectDelay(failures: number, afterMs: number | undefined): number {
  if (afterMs !== undefined) return Math.min(afterMs, RECONNECT_MAX_MS);
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, failures - 1));
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/**
 * The highest revision passed on per record, so changes delivered out of
 * order are dropped (UNS orders by write transaction, not by commit).
 */
class SeenRevisions {
  private readonly revisions = new Map<string, number>();

  constructor(private readonly max: number) {}

  /** Whether the change is new; remembers its revision, or forgets the record on delete. */
  admit(collectionId: string, recordId: string, revision: number, change: 'record' | 'delete'): boolean {
    const key = `${collectionId}\u0000${recordId}`;
    const seen = this.revisions.get(key);
    // A delete always passes, a late one too: the record may be written again under the same ID, from revision 1.
    if (change === 'delete') {
      this.revisions.delete(key);
      return true;
    }
    if (seen !== undefined && revision <= seen) return false;
    this.revisions.delete(key);
    this.revisions.set(key, revision);
    if (this.revisions.size > this.max) this.revisions.delete(this.revisions.keys().next().value!);
    return true;
  }

  clear() {
    this.revisions.clear();
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export function createSubscribe(runtime: SubscribeRuntime) {
  return async function* subscribe(options: SubscribeOptions = {}): AsyncGenerator<SubscriptionEvent, void, undefined> {
    const definitions = [...new Set((options.collections ?? runtime.declared).map(runtime.lookup))];
    if (definitions.length < 1 || definitions.length > UNS_V2_SUBSCRIBE_MAX_COLLECTIONS) {
      throw new TypeError(`data.subscribe watches 1–${UNS_V2_SUBSCRIBE_MAX_COLLECTIONS} collections; got ${definitions.length}.`);
    }
    const recordIds = options.recordIds === undefined ? undefined : [...new Set(options.recordIds)];
    if (recordIds && (recordIds.length < 1 || recordIds.length > UNS_V2_SUBSCRIBE_MAX_RECORD_IDS || definitions.length !== 1)) {
      throw new TypeError(`data.subscribe takes 1–${UNS_V2_SUBSCRIBE_MAX_RECORD_IDS} recordIds, of exactly one collection.`);
    }
    if (options.lastEventId !== undefined) assertEventId(options.lastEventId);
    const idleMs = options.idleTimeoutMs ?? SUBSCRIBE_IDLE_TIMEOUT_MS;
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) stop.abort();
    let lastEventId = options.lastEventId;
    let failures = 0;
    const seen = new SeenRevisions(SUBSCRIBE_SEEN_RECORDS_MAX);
    /** Waits, longer each time, before the next attempt. */
    const backOff = async (afterMs?: number) => {
      failures += 1;
      await pause(reconnectDelay(failures, afterMs), stop.signal);
    };
    try {
      while (!stop.signal.aborted) {
        let state: EnsureState;
        try {
          state = await runtime.ensure(definitions);
        } catch (error) {
          // A freshly imported App answers APP_NOT_READY for a while: keep waiting for it.
          if (!(error instanceof DataError) || !error.retry.safe || stop.signal.aborted) throw error;
          await backOff(error.retry.afterMs);
          continue;
        }
        const aliases = new Map<string, string>();
        for (const definition of definitions) {
          const id = await runtime.resolve(definition);
          aliases.set(id, collectionLabel(definition));
        }

        const connection = new AbortController();
        const closeConnection = () => connection.abort();
        stop.signal.addEventListener('abort', closeConnection, { once: true });
        let idle: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
          clearTimeout(idle);
          idle = setTimeout(closeConnection, idleMs);
        };
        const openedAt = Date.now();
        let healthy = false;
        let reset = false;
        try {
          arm();
          const stream = runtime.openStream(
            { collectionIds: [...aliases.keys()], ...(recordIds ? { recordIds } : {}) },
            { lastEventId, signal: connection.signal },
          );
          for await (const event of stream) {
            arm();
            if (Date.now() - openedAt >= HEALTHY_CONNECTION_MS) healthy = true;
            if (event.type === 'heartbeat') {
              // The connect heartbeat names the current position: resuming from it loses nothing.
              if (event.eventId !== undefined) lastEventId = event.eventId;
              continue;
            }
            if (event.type === 'reset') {
              lastEventId = undefined;
              reset = true;
              // The consumer rereads everything; revisions seen before mean nothing for what follows.
              seen.clear();
              yield event.message === undefined ? { type: 'reset', reason: event.reason } : { type: 'reset', reason: event.reason, message: event.message };
              continue;
            }
            healthy = true;
            // A dropped change is still a resume position.
            lastEventId = event.eventId;
            if (!seen.admit(event.collectionId, event.recordId, event.revision, event.change)) continue;
            yield {
              type: 'change',
              eventId: event.eventId,
              collection: aliases.get(event.collectionId) ?? event.collectionId,
              collectionId: event.collectionId,
              occurredAt: event.occurredAt,
              change: event.change,
              recordId: event.recordId,
              revision: event.revision,
            };
          }
        } catch (error) {
          if (stop.signal.aborted) return;
          if (!(error instanceof DataError)) throw error;
          if (isStaleCollectionError(error)) {
            let changed: boolean;
            try {
              changed = await runtime.rebuild(state, error, definitions);
            } catch (cause) {
              if (!(cause instanceof DataError) || !cause.retry.safe) throw cause;
              await backOff(cause.retry.afterMs);
              continue;
            }
            if (!changed) throw error;
            // Recreated collections have new IDs; their old cursor means nothing.
            lastEventId = undefined;
            seen.clear();
            yield { type: 'reset', reason: 'COLLECTION_RECREATED' };
            continue;
          }
          if (!error.retry.safe) throw error;
          await backOff(error.retry.afterMs);
          continue;
        } finally {
          clearTimeout(idle);
          connection.abort();
          stop.signal.removeEventListener('abort', closeConnection);
        }
        // The stream ended or went silent. Reconnect at once after a healthy connection, else back off.
        if (Date.now() - openedAt >= HEALTHY_CONNECTION_MS) healthy = true;
        if (healthy) failures = 0;
        else failures += 1;
        // A reset always waits a moment: a server resetting in a loop is not reconnected to in a loop.
        const wait = Math.max(reset ? RESET_PAUSE_MS : 0, healthy ? 0 : reconnectDelay(failures, undefined));
        if (wait > 0) await pause(wait, stop.signal);
      }
    } finally {
      stop.abort();
      options.signal?.removeEventListener('abort', onAbort);
    }
  };
}
