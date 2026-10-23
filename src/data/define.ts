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
/** UNS: one ensure takes 1–64 declarations, and an App owns at most 64 collections. */
export const MAX_COLLECTIONS = 64;
/** UNS: collection description length in characters. */
export const MAX_DESCRIPTION_LENGTH = 512;
/** Seeds are inserted in atomic chunks of 200 during the first request; keep them a baseline, not a data import. */
export const MAX_SEED_DOCUMENTS = 1000;

/** Same shape as collection metadata indexes, limited to record indexes. */
export interface IndexSpec {
  /** Business field path without `data.`, e.g. `code` or `customer.id`. */
  path?: string;
  /** Compound index, at most 3 paths. Mutually exclusive with `path`. */
  paths?: string[];
  unique?: boolean;
  /** `btree` (default) or `gin` for one object/array path; GIN cannot be unique. */
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

/** A stored record as services read it: `{ _id, ...fields, _meta }`. */
export type Doc<C extends CollectionDefinition> = z.output<C['schema']> & {
  _id: string;
  _meta: RecordMeta;
};

/** A record to insert: the schema input plus an optional caller-chosen `_id`. */
export type NewDoc<C extends CollectionDefinition> = z.input<C['schema']> & {
  _id?: string;
};

export function defineCollection<S extends CollectionSchema>(definition: {
  alias: string;
  schema: S;
  indexes?: IndexSpec[];
  description?: string;
  seed?: SeedDoc<S>[];
}): CollectionDefinition<S> {
  if (!ALIAS_PATTERN.test(definition.alias)) {
    throw new Error(
      `Collection alias "${definition.alias}" must match ${ALIAS_PATTERN} (letters, digits, "_" or "-", starting with a letter).`,
    );
  }
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
    schema: definition.schema,
    indexes: Object.freeze([...(definition.indexes ?? [])]),
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.seed ? { seed: Object.freeze([...definition.seed]) } : {}),
  });
}
