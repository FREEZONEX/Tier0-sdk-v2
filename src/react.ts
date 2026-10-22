import { useMutation, useQuery, type QueryKey } from '@tanstack/react-query';
import type { Tier0Client } from './client.js';
import { clientScope } from './framework-scope.js';

/** Scope caches by client identity. Use only read operations here; writes belong in mutations. */
export function useTier0Query<T>(client: Tier0Client, key: QueryKey, query: (client: Tier0Client, signal: AbortSignal) => Promise<T>, options: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery<T>({ ...options, queryKey: ['tier0-sdk-v2', clientScope(client), ...key],
    queryFn: ({ signal }) => query(client, signal), retry: false });
}
/** The SDK does not retry mutations or replay an unknown outcome. */
export function useTier0Mutation<T, Variables>(client: Tier0Client, mutation: (client: Tier0Client, variables: Variables) => Promise<T>) {
  return useMutation<T, Error, Variables>({ mutationFn: variables => mutation(client, variables), retry: false });
}
