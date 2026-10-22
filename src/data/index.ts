/**
 * `@tier0/sdk-v2/data` — server-only App data layer over Tier0 UNS collections.
 *
 *   import { createDataClient, defineCollection } from '@tier0/sdk-v2/data';
 *
 *   const data = createDataClient({ collections: [workOrders] });
 *   const open = await data.collection(workOrders).find({ status: 'OPEN' }, { limit: 50 }).toArray();
 *
 * Declarations are ensured in one batch on first access. Requires `zod` 4.
 */
export { createDataClient } from './client.js';
export type { DataClient, DataClientConfig, TransactAction, TransactResult, TransactResultItem, TransactStep } from './client.js';
export type { DataEnvironment, EnsureConflict, EnsureNote, EnsureResult, EnsureState, EnsureWarning, Logger } from './bootstrap.js';
export { MAX_ATOMIC_ITEMS } from './collection.js';
export type { BulkOperation, Collection, Cursor, FindOneAndOptions, FindOptions, FindPageOptions, Projection, Update, UpdateOptions, WithMeta } from './collection.js';
export { defineCollection, MAX_COLLECTIONS } from './define.js';
export type { CollectionDefinition, CollectionSchema, Doc, IndexSpec, NewDoc, RecordMeta, SeedDoc } from './define.js';
export { currentDataSubject, runAsApp, runWithRequestContext } from './context.js';
export { ACCESS_REASONS, DataError } from './error.js';
export { CollectionSchemaError, compileCollection, validateDocument } from './schema.js';
export type { CompiledCollection, NormalizedIndex, RecordSchema, SchemaIssue } from './schema.js';
export { toSortPairs } from './sort.js';
export type { Filter, Sort, SortDirection, SortPairs } from './sort.js';
