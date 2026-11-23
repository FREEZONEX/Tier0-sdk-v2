/**
 * Collection declarations — the single source of truth for App data.
 *
 * An App declares every collection with `defineCollection(...)` and passes the
 * list to `createDataClient({ collections })`. The client ensures that list in
 * one batch on first data access: a missing collection is created, a
 * declaration wider than storage widens it, and nothing is ever narrowed.
 *
 * This module is pure (Zod types only) so declarations, API input schemas and
 * build-time checks can import it without pulling in the runtime client.
 */
import type { z } from 'zod';

/** Collection alias: unique per App, case-insensitive. */
export const ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
/** UNS: one ensure takes 1–128 declarations, and an App owns at most 128 active collections. */
export const MAX_COLLECTIONS = 128;
/** UNS: collection description length in characters. */
export const MAX_DESCRIPTION_LENGTH = 512;
/** UNS: business-facing collection name length in Unicode characters. */
export const MAX_NAME_LENGTH = 63;
/** Business directory paths may omit unknown ISA-95 levels. */
export const MAX_DIRECTORY_DEPTH = 16;
/** Seeds are inserted in atomic chunks of 200 during the first request; keep them a baseline, not a data import. */
export const MAX_SEED_DOCUMENTS = 1000;

/**
 * Same shape as collection metadata indexes, limited to record indexes.
 *
 * 只声明业务约束：唯一键（`unique: true`）和 TTL（`expireAfterSeconds`）。
 * 过滤、排序、`$lookup` 用的查询索引由平台按线上查询自动建删，不需要声明。
 *
 * 普通（非唯一、非 TTL）声明已弃用：类型仍然接受，老代码不用改，但这类声明只作
 * 提示，不保证建出对应的物理索引，`assertIndexesReady` 也不检查它。传入这类声明
 * 时 `defineCollection` 会落到标了 `@deprecated` 的重载上，编辑器会给出提示。
 */
export interface IndexSpec {
  /** Business field path without `data.`, e.g. `code` or `customer.id`. */
  path?: string;
  /** Compound index, at most 3 paths. Mutually exclusive with `path`. */
  paths?: string[];
  /** 业务唯一键。唯一索引由 App 声明并负责，ready 后才可依赖唯一约束或 upsert。 */
  unique?: boolean;
  /**
   * `btree` (default) or `gin` for one object/array path; GIN cannot be unique.
   *
   * @deprecated GIN 只能是普通索引，已由平台自动管理；声明只作提示。
   */
  kind?: 'btree' | 'gin';
  /**
   * TTL index: UNS physically deletes a record this many seconds
   * (60–31536000) after the instant in `path`, an integer field of Unix
   * milliseconds. At most one per collection, on a single non-unique `path`. Expired
   * records cannot be restored. ensure may add a TTL or lengthen it;
   * shortening or removing it takes schema:replace.
   */
  expireAfterSeconds?: number;
}

/** App 负责的约束声明：唯一键或 TTL。 */
export type ConstraintIndexSpec = IndexSpec & ({ unique: true } | { expireAfterSeconds: number });

/** System metadata of a stored record. Times are Unix milliseconds. */
export interface RecordMeta {
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type CollectionSchema = z.ZodObject;

/** A seed document: a full record plus the fixed `_id` it is inserted with. */
export type SeedDoc<S extends CollectionSchema> = z.input<S> & { _id: string };

export interface CollectionDefinition<S extends CollectionSchema = CollectionSchema> {
  readonly alias: string;
  /** Business-facing name, independent of the stable App alias. */
  readonly name: string;
  /** Workspace-root business path. Required when creating a new collection; omitted only for existing aliases. */
  readonly directoryPath?: readonly string[];
  /** Zod 4 object schema of the record body (no `_id` / `_meta`). */
  readonly schema: S;
  readonly indexes: readonly IndexSpec[];
  readonly description?: string;
  /**
   * Baseline records, written only when ensure reports this collection as
   * `created`. Never re-applied to an existing collection.
   */
  readonly seed?: readonly SeedDoc<S>[];
}

/** An existing collection. The optional schema validates writes locally; it never changes storage. */
export interface CollectionReference<S extends CollectionSchema = CollectionSchema> {
  readonly collectionId: string;
  readonly schema?: S;
}

export type CollectionTarget = CollectionDefinition | CollectionReference;

export function collectionLabel(target: CollectionTarget): string {
  return 'collectionId' in target ? target.collectionId : target.alias;
}

/** A stored record as services read it: `{ _id, ...fields, _meta }`. */
export type Doc<C extends CollectionDefinition> = z.output<C['schema']> & {
  _id: string;
  _meta: RecordMeta;
};

/** A record to insert: the schema input plus an optional caller-chosen `_id`. */
export type NewDoc<C extends CollectionDefinition> = z.input<C['schema']> & {
  _id?: string;
};

/** `defineCollection` 的参数；`indexes` 只需声明唯一键和 TTL。 */
export interface CollectionDeclaration<S extends CollectionSchema, I extends IndexSpec = IndexSpec> {
  alias: string;
  name: string;
  directoryPath?: readonly string[];
  schema: S;
  /** 只写唯一键和 TTL；查询索引由平台自动建删。 */
  indexes?: I[];
  description?: string;
  seed?: SeedDoc<S>[];
}

export function defineCollection<S extends CollectionSchema>(definition: CollectionDeclaration<S, ConstraintIndexSpec>): CollectionDefinition<S>;
/**
 * @deprecated `indexes` 里有普通（非唯一、非 TTL）索引声明。查询索引已由平台按
 * 线上查询自动建删，这类声明只作提示；删掉它们，只保留唯一键和 TTL。
 */
export function defineCollection<S extends CollectionSchema>(definition: CollectionDeclaration<S>): CollectionDefinition<S>;
export function defineCollection<S extends CollectionSchema>(definition: CollectionDeclaration<S>): CollectionDefinition<S> {
  if (!ALIAS_PATTERN.test(definition.alias)) {
    throw new Error(
      `Collection alias "${definition.alias}" must match ${ALIAS_PATTERN} (letters, digits, "_" or "-", starting with a letter).`,
    );
  }
  assertCollectionName(definition.name);
  if (definition.directoryPath !== undefined) assertDirectoryPath(definition.directoryPath);
  if (definition.description && [...definition.description].length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Collection "${definition.alias}": description is longer than ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (definition.seed && definition.seed.length > MAX_SEED_DOCUMENTS) {
    throw new Error(
      `Collection "${definition.alias}": at most ${MAX_SEED_DOCUMENTS} seed documents (got ${definition.seed.length}). Seeds are a baseline written on creation, not a bulk import.`,
    );
  }
  return Object.freeze({
    alias: definition.alias,
    name: definition.name,
    ...(definition.directoryPath !== undefined ? { directoryPath: Object.freeze([...definition.directoryPath]) } : {}),
    schema: definition.schema,
    indexes: Object.freeze([...(definition.indexes ?? [])]),
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.seed ? { seed: Object.freeze([...definition.seed]) } : {}),
  });
}

export function assertCollectionName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length === 0 || name.trim() !== name || [...name].length > MAX_NAME_LENGTH || /[\/\0]/.test(name)) {
    throw new Error(`Collection name must be nonempty, at most ${MAX_NAME_LENGTH} Unicode characters, without surrounding whitespace, "/" or NUL.`);
  }
}

/** Validate each business name as one segment; no normalization or fabricated levels. */
export function assertDirectoryPath(path: unknown): asserts path is readonly string[] {
  if (!Array.isArray(path) || path.length < 1 || path.length > MAX_DIRECTORY_DEPTH) {
    throw new Error(`directoryPath must contain 1–${MAX_DIRECTORY_DEPTH} business directory names from the workspace root.`);
  }
  for (let index = 0; index < path.length; index += 1) {
    try {
      assertCollectionName(path[index]);
    } catch {
      throw new Error(`directoryPath[${index}] must be a nonempty business name of at most ${MAX_NAME_LENGTH} Unicode characters, without surrounding whitespace, "/" or NUL.`);
    }
  }
}
