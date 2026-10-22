/** Mongo-style filters and sort specs as the data layer accepts them. Pure module. */

export type Filter = Record<string, unknown>;
export type SortDirection = 1 | -1 | 'asc' | 'desc' | 'ascending' | 'descending';
/** `{ field: 1 | -1 }` (Mongo) or UNS pairs `[["field", 1 | -1]]`. */
export type Sort = Record<string, SortDirection> | ReadonlyArray<readonly [string, 1 | -1]>;
export type SortPairs = [string, 1 | -1][];

/** UNS accepts at most 4 sort pairs and appends `_id` as the tie breaker. */
export function toSortPairs(sort: Sort | undefined): SortPairs | undefined {
  if (!sort) return undefined;
  const pairs: SortPairs = Array.isArray(sort)
    ? sort.map(([field, direction]) => [field, direction])
    : Object.entries(sort as Record<string, SortDirection>).map(([field, direction]) => [
        field,
        direction === -1 || direction === 'desc' || direction === 'descending' ? -1 : 1,
      ]);
  if (pairs.length === 0) return undefined;
  if (pairs.length > 4) throw new Error('UNS sorts by at most 4 fields.');
  return pairs;
}
