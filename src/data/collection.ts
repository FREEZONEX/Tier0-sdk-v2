/**
 * Mongo-driver-style collection handle over the UNS record operations
 * (`recordFind`, `recordInsertMany`, ...).
 *
 * Stored records `{ id, data, revision, createdAt, updatedAt }` are exposed as
 * flat documents `{ _id, ...data, _meta: { revision, createdAt, updatedAt } }`;
 * filters, sorts and projections use the same paths (`status`,
 * `customer.id`, `_id`, `_meta.updatedAt`).
 */
import type { UnsV2OperationName } from '../uns-v2/generated.js';
import type { CallOptions, DataCall } from './call.js';
import type { CollectionDefinition, RecordMeta } from './define.js';
import { DataError } from './error.js';
import { validateDocument, validateUpdate } from './schema.js';
import { toSortPairs, type Filter, type Sort, type SortPairs } from './sort.js';

/** UNS page limit for find / aggregate / distinct. */
export const MAX_PAGE_SIZE = 200;

/**
 * UNS commits at most 200 items in one synchronous atomic batch
 * (insertMany, bulkWrite, data.transact).
 */
export const MAX_ATOMIC_ITEMS = 200;

export type WithMeta<T> = T & { _id: string; _meta: RecordMeta };
export type Projection = Record<string, 0 | 1 | boolean>;
export type Update = Record<string, unknown>;

export interface UnsRecord {
  id: string;
  data: Record<string, unknown>;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

interface PageInfo {
  hasMore: boolean;
  nextCursor?: string | null;
  nextPage?: number | null;
}

/** Position of the next page: an opaque cursor or a 1-based offset page number. */
type PageToken = string | number;

interface Page<T> {
  items: T[];
  /** Token of the following page; null when this was the last one. */
  next: PageToken | null;
}

interface WriteResult {
  value?: UnsRecord | null;
  matchedCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
  insertedCount?: number;
  upsertedId?: string | null;
  insertedIds?: Record<string, string>;
  upsertedIds?: Record<string, string>;
  upsertedCount?: number;
  writeErrors?: unknown[];
  hasMore?: boolean;
  resumeAfter?: string | null;
}

/** Runtime services a collection handle needs from its client. */
export interface CollectionRuntime {
  call: DataCall;
  /** Collection ID of a declaration or declared alias, ensuring all declarations first. */
  resolve(target: CollectionDefinition | string): Promise<string>;
  /** Runs a call, re-ensuring and retrying once when its collection ID went stale (see bootstrap). */
  recover<R>(fn: () => Promise<R>, options?: { retry?: boolean }): Promise<R>;
  /** Data subject of the request being served. */
  subject(): string | undefined;
}

/** Rejects batches UNS would refuse, before anything is sent. */
export function assertAtomicBatch(operation: string, count: number) {
  if (count > MAX_ATOMIC_ITEMS) {
    throw new DataError({
      message:
        `${operation} commits at most ${MAX_ATOMIC_ITEMS} items atomically; got ${count}. ` +
        `Split the input into chunks of ${MAX_ATOMIC_ITEMS} (each chunk commits on its own; give each chunk a stable ` +
        'idempotencyKey or fixed _ids so a retry is safe), or keep all-or-nothing work within one batch.',
      status: 400,
      code: 'BATCH_LIMIT_EXCEEDED',
    });
  }
}

export function toDoc<T>(record: UnsRecord): WithMeta<T> {
  return {
    ...(record.data as T),
    _id: record.id,
    _meta: { revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt },
  };
}

/**
 * Async-iterable result set. Pages hold at most 200 items; the page source
 * decides whether the next page is reached by cursor or by offset page number.
 */
export class Cursor<T> implements AsyncIterable<T> {
  private sortSpec?: Sort;
  private limitCount?: number;
  private projection?: Projection;
  private started = false;

  constructor(
    private readonly fetchPage: (state: {
      token: PageToken | null;
      size: number;
      sort?: SortPairs;
      projection?: Projection;
    }) => Promise<Page<T>>,
    options: { sort?: Sort; limit?: number; projection?: Projection } = {},
  ) {
    this.sortSpec = options.sort;
    this.limitCount = options.limit;
    this.projection = options.projection;
  }

  private assertNotStarted() {
    if (this.started) throw new Error('Cursor options must be set before iteration starts.');
  }

  sort(sort: Sort): this {
    this.assertNotStarted();
    this.sortSpec = sort;
    return this;
  }

  /** Total number of documents to return (pages are fetched ≤200 at a time). */
  limit(count: number): this {
    this.assertNotStarted();
    this.limitCount = count;
    return this;
  }

  project(projection: Projection): this {
    this.assertNotStarted();
    this.projection = projection;
    return this;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    this.started = true;
    const sort = toSortPairs(this.sortSpec);
    let remaining = this.limitCount ?? Number.POSITIVE_INFINITY;
    // One page size for the whole iteration: offset pages are only stable when it never changes.
    const size = Math.min(MAX_PAGE_SIZE, remaining);
    let token: PageToken | null = null;
    while (remaining > 0) {
      const page = await this.fetchPage({ token, size, sort, projection: this.projection });
      for (const item of page.items.slice(0, remaining)) yield item;
      remaining -= page.items.length;
      if (page.next === null || page.items.length === 0) return;
      token = page.next;
    }
  }

  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}

/** Pipelines made only of `$match` / `$sort` page by cursor; UNS requires offset paging for any other stage. */
function isDirectPipeline(stages: readonly Record<string, unknown>[]): boolean {
  return stages.every((stage) => Object.keys(stage).every((key) => key === '$match' || key === '$sort'));
}

export interface FindOptions {
  sort?: Sort;
  limit?: number;
  projection?: Projection;
}

export interface FindPageOptions {
  sort?: Sort;
  /** 1-based page number. */
  page?: number;
  /** At most 200. */
  pageSize?: number;
  projection?: Projection;
}

export interface UpdateOptions {
  upsert?: boolean;
  /** Reject the write with VERSION_CONFLICT unless the record is at this revision. */
  expectedRevision?: number;
  sort?: Sort;
  arrayFilters?: Record<string, unknown>[];
  idempotencyKey?: string;
  /** The canonical write keeps counts and optionally returns a document atomically. */
  returnDocument?: 'none' | 'before' | 'after';
  /** Only valid with an explicit before/after returnDocument. */
  projection?: Projection;
}

export interface FindOneAndOptions extends UpdateOptions {
  returnDocument?: 'before' | 'after';
  projection?: Projection;
}

export type DeleteOneOptions = Pick<UpdateOptions, 'expectedRevision' | 'sort' | 'idempotencyKey' | 'projection'> & {
  returnDocument?: 'none' | 'before';
};
export type UpdateOneResult<T> = { matchedCount: number; modifiedCount: number; upsertedId: string | null; value?: WithMeta<T> | null };
export type DeleteOneResult<T> = { deletedCount: number; value?: WithMeta<T> | null };

function validateReturnDocument(options: Pick<UpdateOptions, 'returnDocument' | 'projection'>, deletion = false) {
  if (options.projection !== undefined && (!options.returnDocument || options.returnDocument === 'none')) {
    throw new TypeError('projection requires returnDocument before or after.');
  }
  if (deletion && options.returnDocument === 'after') throw new TypeError('deleteOne cannot return an after document.');
}

export type BulkOperation =
  | { insertOne: { document: Record<string, unknown> } }
  | { updateOne: { filter: Filter; update: Update; upsert?: boolean; sort?: Sort } }
  | { replaceOne: { filter: Filter; replacement: Record<string, unknown>; upsert?: boolean; sort?: Sort } }
  | { deleteOne: { filter: Filter; sort?: Sort } };

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function idsInOrder(ids: Record<string, string> | undefined): string[] {
  return Object.entries(ids ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, id]) => id);
}

function assertNoWriteErrors(result: WriteResult, operation: string, committed: Record<string, number> = {}) {
  if (result.writeErrors && result.writeErrors.length > 0) {
    const counts = Object.entries(committed).map(([name, value]) => `${name}=${value}`).join(', ');
    throw new DataError({
      message: `${operation} stopped on ${result.writeErrors.length} write error(s)${counts ? `; already committed: ${counts}` : ''}.`,
      status: 409,
      code: 'WRITE_ERRORS',
      details: { writeErrors: result.writeErrors, committed },
    });
  }
}

export class Collection<T extends object = Record<string, unknown>, TInput extends object = T> {
  constructor(
    readonly definition: CollectionDefinition,
    private readonly runtime: CollectionRuntime,
  ) {}

  get alias(): string {
    return this.definition.alias;
  }

  /**
   * One call with stale-ID recovery. A call continuing a cursor or
   * resumeAfter token of the old collection is not retried: the token means
   * nothing to a recreated collection.
   */
  private post<R>(operation: UnsV2OperationName, body: Record<string, unknown>, options: CallOptions = {}): Promise<R> {
    const page = body.page as { cursor?: unknown } | undefined;
    const continues = typeof body.cursor === 'string' || typeof body.resumeAfter === 'string' || typeof page?.cursor === 'string';
    return this.runtime.recover(() => this.send<R>(operation, body, options), { retry: !continues });
  }

  private async send<R>(operation: UnsV2OperationName, body: Record<string, unknown>, options: CallOptions = {}): Promise<R> {
    const collectionId = await this.runtime.resolve(this.definition);
    return this.runtime.call<R>(operation, { collectionId, ...compact(body) }, { dataSubject: this.runtime.subject(), ...options });
  }

  /* ---------------------------------- reads --------------------------------- */

  find(filter: Filter = {}, options: FindOptions = {}): Cursor<WithMeta<T>> {
    return new Cursor<WithMeta<T>>(async ({ token, size, sort, projection }) => {
      const result = await this.post<{ items: UnsRecord[]; pageInfo: PageInfo }>('recordFind', {
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        sort,
        projection,
        limit: size,
        cursor: typeof token === 'string' ? token : undefined,
      });
      return {
        items: result.items.map((record) => toDoc<T>(record)),
        next: result.pageInfo.hasMore && result.pageInfo.nextCursor ? result.pageInfo.nextCursor : null,
      };
    }, options);
  }

  async findOne(filter: Filter = {}, options: Omit<FindOptions, 'limit'> = {}): Promise<WithMeta<T> | null> {
    const [first] = await this.find(filter, { ...options, limit: 1 }).toArray();
    return first ?? null;
  }

  /**
   * One numbered page plus the total match count, for paged list screens.
   * Uses `recordAggregatePipeline` offset paging.
   */
  async findPage(
    filter: Filter = {},
    options: FindPageOptions = {},
  ): Promise<{ items: WithMeta<T>[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Math.trunc(options.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(options.pageSize ?? 20)));
    const pipeline: Record<string, unknown>[] = [];
    if (Object.keys(filter).length > 0) pipeline.push({ $match: filter });
    const sort = toSortPairs(options.sort);
    if (sort) pipeline.push({ $sort: sort });
    if (options.projection) pipeline.push({ $project: options.projection });
    const [rows, total] = await Promise.all([
      this.post<{ items: WithMeta<T>[] }>('recordAggregatePipeline', { pipeline, page: { mode: 'offset', page, size: pageSize } }),
      this.countDocuments(filter),
    ]);
    return { items: rows.items, total, page, pageSize };
  }

  async countDocuments(filter: Filter = {}): Promise<number> {
    const result = await this.post<{ count: number }>('recordCount', {
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });
    return result.count;
  }

  /** Distinct values of a field (every page). */
  async distinct(field: string, filter: Filter = {}): Promise<unknown[]> {
    const values: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.post<{ values: unknown[]; pageInfo: PageInfo }>('recordDistinct', {
        field,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        page: { mode: 'offset', page, size: MAX_PAGE_SIZE },
      });
      values.push(...result.values);
      if (!result.pageInfo.hasMore) return values;
    }
  }

  /**
   * Runs a pipeline (`$match`, `$sort`, `$group`, `$project`, `$set`,
   * `$lookup`, `$unwind`, `$skip`, `$limit`, `$count`). `$sort` accepts
   * `{ field: 1 | -1 }`; `$lookup` takes `from` (a declared collection or
   * alias of this App) instead of a collection ID. Rows are whatever the
   * pipeline outputs, not wrapped records.
   *
   * Pipelines of only `$match` / `$sort` page by cursor; any other stage pages
   * by offset (UNS rejects cursors for transformed results). The `$exists`,
   * `$distinct` and `$frequencies` stages are listed in the UNS schema but not
   * executed by the record pipeline; use `countDocuments`, `distinct` or `$group`.
   */
  aggregate<R = Record<string, unknown>>(pipeline: Record<string, unknown>[]): Cursor<R> {
    // Recovery wraps stage preparation too, so a retry re-resolves `$lookup` IDs.
    return new Cursor<R>(({ token, size }) => this.runtime.recover(() => this.aggregatePage<R>(pipeline, token, size), { retry: typeof token !== 'string' }));
  }

  private async aggregatePage<R>(
    pipeline: Record<string, unknown>[],
    token: PageToken | null,
    size: number,
  ): Promise<Page<R>> {
    const stages = await this.prepareStages(pipeline);
    const last = stages[stages.length - 1];
    if (last !== undefined && '$count' in last) {
      // A final $count returns one row and forbids an explicit page.
      const result = await this.send<{ items: R[] }>('recordAggregatePipeline', { pipeline: stages });
      return { items: result.items, next: null };
    }
    if (isDirectPipeline(stages)) {
      const result = await this.send<{ items: R[]; pageInfo: PageInfo }>('recordAggregatePipeline', {
        pipeline: stages,
        page: { mode: 'cursor', size, ...(typeof token === 'string' ? { cursor: token } : {}) },
      });
      return { items: result.items, next: result.pageInfo.hasMore && result.pageInfo.nextCursor ? result.pageInfo.nextCursor : null };
    }
    const page = typeof token === 'number' ? token : 1;
    const result = await this.send<{ items: R[]; pageInfo: PageInfo }>('recordAggregatePipeline', {
      pipeline: stages,
      page: { mode: 'offset', page, size },
    });
    return {
      items: result.items,
      next: result.pageInfo.hasMore ? (result.pageInfo.nextPage ?? page + 1) : null,
    };
  }

  /** Converts Mongo-style `$sort` objects and resolves `$lookup.from`, recursively. */
  private async prepareStages(pipeline: readonly Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    return Promise.all(
      pipeline.map(async (stage) => {
        if ('$sort' in stage && !Array.isArray(stage.$sort)) {
          return { ...stage, $sort: toSortPairs(stage.$sort as Sort) };
        }
        if ('$lookup' in stage && stage.$lookup && typeof stage.$lookup === 'object') {
          const { from, pipeline: inner, ...lookup } = stage.$lookup as Record<string, unknown>;
          const resolved: Record<string, unknown> = { ...lookup };
          if (from !== undefined) resolved.collectionId = await this.runtime.resolve(from as CollectionDefinition | string);
          if (Array.isArray(inner)) resolved.pipeline = await this.prepareStages(inner as Record<string, unknown>[]);
          return { ...stage, $lookup: resolved };
        }
        return stage;
      }),
    );
  }

  /* --------------------------------- writes --------------------------------- */

  async insertOne(document: TInput & { _id?: string }, options: { idempotencyKey?: string } = {}): Promise<{ insertedId: string }> {
    const { id, data } = validateDocument(this.definition, document as Record<string, unknown>);
    const result = await this.post<{ insertedId: string }>('recordInsertOne', { id, data, idempotencyKey: options.idempotencyKey });
    return { insertedId: result.insertedId };
  }

  /** Inserts up to 200 documents atomically (all or none). */
  async insertMany(
    documents: readonly (TInput & { _id?: string })[],
    options: { idempotencyKey?: string } = {},
  ): Promise<{ insertedCount: number; insertedIds: string[] }> {
    if (documents.length === 0) return { insertedCount: 0, insertedIds: [] };
    assertAtomicBatch('insertMany', documents.length);
    const prepared = documents.map((document) => validateDocument(this.definition, document as Record<string, unknown>));
    const result = await this.post<WriteResult>('recordInsertMany', {
      documents: prepared.map(({ id, data }) => compact({ id, data })),
      ordered: true,
      atomic: true,
      idempotencyKey: options.idempotencyKey,
    });
    assertNoWriteErrors(result, 'insertMany');
    return { insertedCount: result.insertedCount ?? 0, insertedIds: idsInOrder(result.insertedIds) };
  }

  updateOne(filter: Filter, update: Update, options: UpdateOptions & { returnDocument: 'before' | 'after' }): Promise<UpdateOneResult<T> & { value: WithMeta<T> | null }>;
  updateOne(filter: Filter, update: Update, options?: UpdateOptions): Promise<UpdateOneResult<T>>;
  async updateOne(
    filter: Filter,
    update: Update,
    options: UpdateOptions = {},
  ): Promise<UpdateOneResult<T>> {
    validateReturnDocument(options);
    const result = await this.post<WriteResult>('recordUpdateOne', {
      filter,
      update: validateUpdate(this.definition, update),
      upsert: options.upsert,
      expectedRevision: options.expectedRevision,
      sort: toSortPairs(options.sort),
      arrayFilters: options.arrayFilters,
      idempotencyKey: options.idempotencyKey,
      returnDocument: options.returnDocument,
      projection: options.projection,
    });
    return { matchedCount: result.matchedCount ?? 0, modifiedCount: result.modifiedCount ?? 0, upsertedId: result.upsertedId ?? null,
      ...(options.returnDocument && options.returnDocument !== 'none' ? { value: result.value ? toDoc<T>(result.value) : null } : {}) };
  }

  /**
   * Updates every match like Mongo's updateMany: documents commit one by one
   * (not atomically), following `resumeAfter` until every match is processed.
   * A failure stops the run and reports the counts already committed. For
   * all-or-nothing multi-document changes use `data.transact` (≤200 items).
   */
  async updateMany(
    filter: Filter,
    update: Update,
    options: Pick<UpdateOptions, 'arrayFilters'> = {},
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const validated = validateUpdate(this.definition, update);
    let matchedCount = 0;
    let modifiedCount = 0;
    let resumeAfter: string | undefined;
    do {
      const result: WriteResult = await this.post<WriteResult>('recordUpdateMany', {
        filter,
        update: validated,
        arrayFilters: options.arrayFilters,
        atomic: false,
        resumeAfter,
      });
      matchedCount += result.matchedCount ?? 0;
      modifiedCount += result.modifiedCount ?? 0;
      assertNoWriteErrors(result, 'updateMany', { matchedCount, modifiedCount });
      resumeAfter = result.hasMore && result.resumeAfter ? result.resumeAfter : undefined;
    } while (resumeAfter);
    return { matchedCount, modifiedCount };
  }

  /**
   * Replaces the whole body. Fields written by another App version and not in
   * this declaration are lost — prefer `updateOne` with `$set`.
   */
  replaceOne(filter: Filter, replacement: TInput, options: Omit<UpdateOptions, 'arrayFilters'> & { returnDocument: 'before' | 'after' }): Promise<UpdateOneResult<T> & { value: WithMeta<T> | null }>;
  replaceOne(filter: Filter, replacement: TInput, options?: Omit<UpdateOptions, 'arrayFilters'>): Promise<UpdateOneResult<T>>;
  async replaceOne(
    filter: Filter,
    replacement: TInput,
    options: Omit<UpdateOptions, 'arrayFilters'> = {},
  ): Promise<UpdateOneResult<T>> {
    validateReturnDocument(options);
    const { data } = validateDocument(this.definition, replacement as Record<string, unknown>);
    const result = await this.post<WriteResult>('recordReplaceOne', {
      filter,
      replacement: data,
      upsert: options.upsert,
      expectedRevision: options.expectedRevision,
      sort: toSortPairs(options.sort),
      idempotencyKey: options.idempotencyKey,
      returnDocument: options.returnDocument,
      projection: options.projection,
    });
    return { matchedCount: result.matchedCount ?? 0, modifiedCount: result.modifiedCount ?? 0, upsertedId: result.upsertedId ?? null,
      ...(options.returnDocument && options.returnDocument !== 'none' ? { value: result.value ? toDoc<T>(result.value) : null } : {}) };
  }

  /** Soft-deletes one record; requires `uns.delete` on the App key. */
  deleteOne(filter: Filter, options: DeleteOneOptions & { returnDocument: 'before' }): Promise<DeleteOneResult<T> & { value: WithMeta<T> | null }>;
  deleteOne(filter: Filter, options?: DeleteOneOptions): Promise<DeleteOneResult<T>>;
  async deleteOne(filter: Filter, options: DeleteOneOptions = {}): Promise<DeleteOneResult<T>> {
    validateReturnDocument(options, true);
    const result = await this.post<WriteResult>(
      'recordDeleteOne',
      { filter, expectedRevision: options.expectedRevision, sort: toSortPairs(options.sort), idempotencyKey: options.idempotencyKey,
        returnDocument: options.returnDocument, projection: options.projection },
    );
    return { deletedCount: result.deletedCount ?? 0,
      ...(options.returnDocument === 'before' ? { value: result.value ? toDoc<T>(result.value) : null } : {}) };
  }

  /**
   * Soft-deletes every match, one document at a time like Mongo's deleteMany
   * (not atomic), following `resumeAfter`; requires `uns.delete` on the App key.
   */
  async deleteMany(filter: Filter): Promise<{ deletedCount: number }> {
    let deletedCount = 0;
    let resumeAfter: string | undefined;
    do {
      const result: WriteResult = await this.post<WriteResult>('recordDeleteMany', { filter, atomic: false, resumeAfter });
      deletedCount += result.deletedCount ?? 0;
      assertNoWriteErrors(result, 'deleteMany', { deletedCount });
      resumeAfter = result.hasMore && result.resumeAfter ? result.resumeAfter : undefined;
    } while (resumeAfter);
    return { deletedCount };
  }

  /**
   * Compatibility operation: keeps its original route, return default and receipt identity.
   * New requests can use updateOne with returnDocument. A state transition puts the expected state in
   * the filter: `findOneAndUpdate({ _id, status: "DRAFT" }, { $set: { status: "SUBMITTED" } })`
   * returns null when another request moved the record first.
   */
  async findOneAndUpdate(filter: Filter, update: Update, options: FindOneAndOptions = {}): Promise<WithMeta<T> | null> {
    const result = await this.post<{ value: UnsRecord | null }>('recordFindOneAndUpdate', {
      filter,
      update: validateUpdate(this.definition, update),
      upsert: options.upsert,
      expectedRevision: options.expectedRevision,
      sort: toSortPairs(options.sort),
      arrayFilters: options.arrayFilters,
      returnDocument: options.returnDocument ?? 'after',
      projection: options.projection,
      idempotencyKey: options.idempotencyKey,
    });
    return result.value ? toDoc<T>(result.value) : null;
  }

  async findOneAndReplace(
    filter: Filter,
    replacement: TInput,
    options: Omit<FindOneAndOptions, 'arrayFilters'> = {},
  ): Promise<WithMeta<T> | null> {
    const { data } = validateDocument(this.definition, replacement as Record<string, unknown>);
    const result = await this.post<{ value: UnsRecord | null }>('recordFindOneAndReplace', {
      filter,
      replacement: data,
      upsert: options.upsert,
      expectedRevision: options.expectedRevision,
      sort: toSortPairs(options.sort),
      returnDocument: options.returnDocument ?? 'after',
      projection: options.projection,
      idempotencyKey: options.idempotencyKey,
    });
    return result.value ? toDoc<T>(result.value) : null;
  }

  async findOneAndDelete(
    filter: Filter,
    options: Pick<FindOneAndOptions, 'expectedRevision' | 'sort' | 'projection' | 'idempotencyKey'> = {},
  ): Promise<WithMeta<T> | null> {
    const result = await this.post<{ value: UnsRecord | null }>(
      'recordFindOneAndDelete',
      {
        filter,
        expectedRevision: options.expectedRevision,
        sort: toSortPairs(options.sort),
        projection: options.projection,
        idempotencyKey: options.idempotencyKey,
      },
    );
    return result.value ? toDoc<T>(result.value) : null;
  }

  /** Up to 200 mixed single-record writes in one atomic call (insertOne / updateOne / replaceOne / deleteOne). */
  async bulkWrite(
    operations: readonly BulkOperation[],
    options: { idempotencyKey?: string } = {},
  ): Promise<{
    insertedCount: number;
    matchedCount: number;
    modifiedCount: number;
    deletedCount: number;
    upsertedCount: number;
    insertedIds: Record<number, string>;
    upsertedIds: Record<number, string>;
  }> {
    assertAtomicBatch('bulkWrite', operations.length);
    const mapped = operations.map((operation) => {
      if ('insertOne' in operation) {
        const { id, data } = validateDocument(this.definition, operation.insertOne.document);
        return { insertOne: compact({ id, data }) };
      }
      if ('updateOne' in operation) {
        const { filter, update, upsert, sort } = operation.updateOne;
        return { updateOne: compact({ filter, update: validateUpdate(this.definition, update), upsert, sort: toSortPairs(sort) }) };
      }
      if ('replaceOne' in operation) {
        const { filter, replacement, upsert, sort } = operation.replaceOne;
        const { data } = validateDocument(this.definition, replacement);
        return { replaceOne: compact({ filter, replacement: data, upsert, sort: toSortPairs(sort) }) };
      }
      if ('deleteOne' in operation) {
        return { deleteOne: compact({ filter: operation.deleteOne.filter, sort: toSortPairs(operation.deleteOne.sort) }) };
      }
      throw new Error(
        `Unsupported bulkWrite operation ${Object.keys(operation).join(', ')}; use updateMany() / deleteMany() or data.transact().`,
      );
    });
    if (mapped.length === 0) {
      return { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {}, upsertedIds: {} };
    }
    const result = await this.post<WriteResult>(
      'recordBulkWrite',
      { operations: mapped, ordered: true, atomic: true, idempotencyKey: options.idempotencyKey },
    );
    assertNoWriteErrors(result, 'bulkWrite');
    const numericKeys = (ids: Record<string, string> | undefined) =>
      Object.fromEntries(Object.entries(ids ?? {}).map(([index, id]) => [Number(index), id]));
    return {
      insertedCount: result.insertedCount ?? 0,
      matchedCount: result.matchedCount ?? 0,
      modifiedCount: result.modifiedCount ?? 0,
      deletedCount: result.deletedCount ?? 0,
      upsertedCount: result.upsertedCount ?? 0,
      insertedIds: numericKeys(result.insertedIds),
      upsertedIds: numericKeys(result.upsertedIds),
    };
  }
}
