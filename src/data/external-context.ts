/**
 * Lightweight external collection alias resolver over `POST /openapi/v2/uns/app/context`.
 *
 * - Single source of truth: Backend `appDataPolicy.collections[].alias -> collectionId`.
 * - Process-level cache with single-flight deduplication; never calls `appCollectionsEnsure`.
 * - On stale collection errors (`COLLECTION_NOT_GRANTED` / `COLLECTION_NOT_FOUND`), refreshes
 *   at most once per `EXTERNAL_REFRESH_INTERVAL_MS` (30 s) so admin rebinds take effect
 *   without restarting the App process.
 * - Missing / revoked / deleted / owner-trashed bindings deterministically raise
 *   `DataError({ code: 'EXTERNAL_COLLECTION_UNBOUND', status: 503, details: { alias } })`.
 */
import type { AppContext } from '../uns-v2/generated.js';
import { REBUILD_INTERVAL_MS, type Logger } from './bootstrap.js';
import type { DataCall } from './call.js';
import type { CollectionAliasReference } from './define.js';
import { DataError, externalCollectionUnboundError } from './error.js';

/** At most one stale-ID or explicit external context refresh per client in this window. */
export const EXTERNAL_REFRESH_INTERVAL_MS = REBUILD_INTERVAL_MS;

/** Short cooldown before re-checking an unbound external alias so new bindings activate without restart. */
export const EXTERNAL_UNBOUND_REFRESH_MS = 5_000;

export interface ExternalCollectionBinding {
  readonly alias: string;
  readonly collectionId: string;
  readonly permissions: readonly string[];
  readonly ownerAppId?: string;
}

export interface ExternalContextSnapshot {
  readonly appId: string;
  readonly fetchedAt: number;
  /** Lower-cased non-empty alias -> binding. */
  readonly byAlias: ReadonlyMap<string, ExternalCollectionBinding>;
  /** collectionId -> binding (for entries with a non-empty alias). */
  readonly byId: ReadonlyMap<string, ExternalCollectionBinding>;
}

export interface ExternalRecoveryOutcome {
  readonly changed: boolean;
  readonly unboundAlias?: string;
  readonly snapshot: ExternalContextSnapshot;
}

export interface ExternalContextConfig {
  call: DataCall;
  ownedAliases: ReadonlySet<string>;
  logger: Logger;
}

export function createExternalContext(config: ExternalContextConfig) {
  const { call, ownedAliases, logger } = config;
  let cached: ExternalContextSnapshot | null = null;
  let pending: Promise<ExternalContextSnapshot> | null = null;
  let refreshing: Promise<ExternalContextSnapshot> | null = null;
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let lastUnboundRefresh = Number.NEGATIVE_INFINITY;

  async function fetchSnapshot(): Promise<ExternalContextSnapshot> {
    // Shared across requests like bootstrap.ensure: one aborted caller must not cancel shared discovery.
    const context = await call<AppContext>('dataAppContext', {});
    if (!context || !Array.isArray(context.collections)) {
      throw new DataError({
        message: 'UNS answered dataAppContext with an invalid response.',
        status: 502,
        code: 'DATA_BAD_RESPONSE',
        execution: 'notStarted',
      });
    }
    const byAlias = new Map<string, ExternalCollectionBinding>();
    const byId = new Map<string, ExternalCollectionBinding>();
    for (const item of context.collections) {
      if (typeof item.alias !== 'string' || !item.alias || typeof item.collectionId !== 'string' || !item.collectionId) {
        continue;
      }
      const key = item.alias.toLowerCase();
      if (ownedAliases.has(key)) continue;
      const binding: ExternalCollectionBinding = {
        alias: item.alias,
        collectionId: item.collectionId,
        permissions: Array.isArray(item.permissions) ? item.permissions : [],
        ...(item.ownerAppId ? { ownerAppId: item.ownerAppId } : {}),
      };
      if (!byAlias.has(key)) byAlias.set(key, binding);
      byId.set(item.collectionId, binding);
    }
    return {
      appId: typeof context.appId === 'string' ? context.appId : '',
      fetchedAt: Date.now(),
      byAlias,
      byId,
    };
  }

  function load(): Promise<ExternalContextSnapshot> {
    if (refreshing) return refreshing;
    pending ??= fetchSnapshot()
      .then((snapshot) => {
        cached = snapshot;
        return snapshot;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
    return pending;
  }

  async function refresh(before?: ExternalContextSnapshot, reason?: string): Promise<ExternalContextSnapshot> {
    if (refreshing) return refreshing;
    if (cached && before && cached !== before) return cached;
    const now = Date.now();
    if (now - lastRefresh < EXTERNAL_REFRESH_INTERVAL_MS) {
      return cached ?? load();
    }
    lastRefresh = now;
    if (reason) {
      logger.warn(`[data] external collection binding may have changed (${reason}); refreshing app context`);
    }
    const next = fetchSnapshot()
      .then((snapshot) => {
        cached = snapshot;
        pending = Promise.resolve(snapshot);
        return snapshot;
      })
      .finally(() => {
        if (refreshing === next) refreshing = null;
      });
    refreshing = next;
    return next;
  }

  async function refreshUnbound(before: ExternalContextSnapshot): Promise<ExternalContextSnapshot> {
    if (refreshing) return refreshing;
    if (cached && cached !== before) return cached;
    const now = Date.now();
    if (now - before.fetchedAt < EXTERNAL_UNBOUND_REFRESH_MS || now - lastUnboundRefresh < EXTERNAL_UNBOUND_REFRESH_MS) {
      return before;
    }
    lastUnboundRefresh = now;
    const next = fetchSnapshot()
      .then((snapshot) => {
        cached = snapshot;
        pending = Promise.resolve(snapshot);
        return snapshot;
      })
      .finally(() => {
        if (refreshing === next) refreshing = null;
      });
    refreshing = next;
    return next;
  }

  async function resolve(alias: string, options?: { refresh?: boolean }): Promise<string> {
    const key = alias.toLowerCase();
    let snapshot: ExternalContextSnapshot;
    if (options?.refresh) {
      snapshot = await refresh(undefined, `resolveCollectionId("${alias}")`);
    } else {
      snapshot = await load();
      if (!snapshot.byAlias.has(key)) {
        snapshot = await refreshUnbound(snapshot);
      }
    }
    const binding = snapshot.byAlias.get(key);
    if (!binding) {
      throw externalCollectionUnboundError(alias);
    }
    return binding.collectionId;
  }

  async function recoverTargets(
    before: ExternalContextSnapshot,
    targets: readonly CollectionAliasReference[],
    cause: DataError,
  ): Promise<ExternalRecoveryOutcome> {
    const baseline = cached ?? before;
    const failedId = typeof cause.details.collectionId === 'string' ? cause.details.collectionId : undefined;
    const beforeIds = new Map<string, string | undefined>();
    for (const target of targets) {
      const key = target.alias.toLowerCase();
      beforeIds.set(key, baseline.byAlias.get(key)?.collectionId);
    }
    if (failedId && ![...beforeIds.values()].includes(failedId)) {
      return { changed: false, snapshot: baseline };
    }
    const after = await refresh(baseline, `${cause.code}: ${cause.reason ?? cause.message}`);
    let changed = false;
    for (const target of targets) {
      const key = target.alias.toLowerCase();
      const next = after.byAlias.get(key);
      if (!next) {
        return { changed: false, unboundAlias: target.alias, snapshot: after };
      }
      if (beforeIds.get(key) !== next.collectionId) {
        changed = true;
      }
    }
    return { changed, snapshot: after };
  }

  function invalidate(): void {
    cached = null;
    pending = null;
  }

  function listReadable(snapshot: ExternalContextSnapshot, filterAliases?: ReadonlySet<string>): ExternalCollectionBinding[] {
    const out: ExternalCollectionBinding[] = [];
    for (const [key, binding] of snapshot.byAlias) {
      if (filterAliases && !filterAliases.has(key)) continue;
      if (!binding.permissions.includes('record:read')) continue;
      out.push(binding);
    }
    return out;
  }

  return { load, refresh, resolve, recoverTargets, invalidate, listReadable };
}
