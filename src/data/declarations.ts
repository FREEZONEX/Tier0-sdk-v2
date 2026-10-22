/**
 * `@tier0/sdk-v2/data/define` — collection declarations, their types and the
 * schema compiler, without the runtime client. Safe for browser bundles: it
 * loads no Node built-ins, transport, request context or bootstrap, so
 * components and routes can import declarations and `Doc` types from here
 * while data reads and writes stay on the server (`@tier0/sdk-v2/data`).
 */
export { defineCollection, MAX_COLLECTIONS } from './define.js';
export type { CollectionDefinition, CollectionSchema, Doc, IndexSpec, NewDoc, RecordMeta, SeedDoc } from './define.js';
export { CollectionSchemaError, compileCollection, validateDocument } from './schema.js';
export type { CompiledCollection, NormalizedIndex, RecordSchema, SchemaIssue } from './schema.js';
