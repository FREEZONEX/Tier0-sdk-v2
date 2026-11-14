import type { AppContext, IndexSpec as StoredIndex } from '../uns-v2/generated.js';
import type { DataCall } from './call.js';
import type { EnsureState } from './bootstrap.js';
import type { CollectionDefinition, IndexSpec } from './define.js';
import { DataError } from './error.js';
import { compileCollection } from './schema.js';

/** Match the constraint, not the server's opaque physical-index name. */
function sameIndex(expected: IndexSpec, actual: StoredIndex): boolean {
  if (Object.keys(actual).some(key => !['path', 'paths', 'unique', 'kind', 'target', 'expireAfterSeconds'].includes(key)) ||
    (actual.unique !== undefined && typeof actual.unique !== 'boolean') ||
    (actual.path !== undefined && actual.paths !== undefined)) return false;
  const paths = (index: { path?: string; paths?: string[] }) => index.paths ?? (index.path === undefined ? [] : [index.path]);
  return JSON.stringify(paths(expected)) === JSON.stringify(paths(actual)) &&
    (expected.kind ?? 'btree') === (actual.kind || 'btree') &&
    Boolean(expected.unique) === Boolean(actual.unique) &&
    (expected.expireAfterSeconds ?? 0) === (actual.expireAfterSeconds ?? 0) &&
    (!actual.target || actual.target === 'records');
}

/** A fresh, read-only readiness snapshot. No polling, index repair or credential fallback. */
export async function assertIndexesReady(
  call: DataCall,
  ensure: () => Promise<EnsureState>,
  definitions: readonly CollectionDefinition[],
  signal?: AbortSignal,
  expectedIds?: ReadonlyMap<string, string>,
): Promise<void> {
  const required = definitions.map(compileCollection).filter(item => item.indexes.length > 0);
  if (!required.length) return;
  const state = await ensure();
  const conflict = state.conflicts.find(item => required.some(definition => definition.alias.toLowerCase() === item.alias.toLowerCase()));
  if (conflict) throw new DataError({
    code: 'SCHEMA_CONFLICT', status: 409,
    message: `Cannot assert index readiness for conflicting collection "${conflict.alias}".`,
    execution: 'notStarted', details: { alias: conflict.alias },
  });
  const context = await call<AppContext>('dataAppContext', {}, { signal });
  if (!state.appId || context.appId !== state.appId || !Array.isArray(context.collections)) throw new DataError({
    code: 'DATA_BAD_RESPONSE', status: 502,
    message: 'The App index-readiness response does not match the ensured App.', execution: 'notStarted',
  });
  for (const definition of required) {
    const alias = definition.alias.toLowerCase();
    const collectionId = expectedIds?.get(alias) ?? state.collectionIds.get(alias);
    const current = context.collections.find(item => item.alias?.toLowerCase() === alias && item.collectionId === collectionId);
    if (!current || !Array.isArray(current.indexStatus)) throw new DataError({
      code: 'INDEX_NOT_READY', status: 503,
      message: `Index state is unavailable for collection "${definition.alias}".`,
      execution: 'notStarted', details: { alias: definition.alias, collectionId },
    });
    for (const index of definition.indexes) {
      const matches = current.indexStatus.filter(item => item.spec && sameIndex(index, item.spec));
      // Missing, duplicated or unknown states cannot establish a constraint.
      if (matches.length === 1 && matches[0].state === 'ready') continue;
      const failed = matches.find(item => item.state === 'failed');
      throw new DataError({
        code: failed ? 'INDEX_BUILD_FAILED' : 'INDEX_NOT_READY', status: 503,
        message: `A declared index of collection "${definition.alias}" is ${failed ? 'failed' : 'not ready'}. Business writes depending on it must not proceed.`,
        execution: 'notStarted',
        // Keep only schema identity/state; upstream diagnostic strings may contain business values.
        details: { alias: definition.alias, collectionId, index, state: failed ? 'failed' : matches[0]?.state ?? 'missing' },
      });
    }
  }
}
