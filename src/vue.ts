import { shallowRef, onScopeDispose, getCurrentScope } from 'vue';
import type { Tier0Client } from './client.js';

/** Explicit execution, with latest-result wins and no automatic mutation replay. */
export function useTier0Request<T, Variables>(client: Tier0Client, request: (client: Tier0Client, variables: Variables, signal: AbortSignal) => Promise<T>) {
  const data = shallowRef<T>();
  const error = shallowRef<unknown>();
  const loading = shallowRef(false);
  let controller: AbortController | undefined;
  let generation = 0;
  const cancel = () => { generation++; controller?.abort(); loading.value = false; };
  if (getCurrentScope()) onScopeDispose(cancel);
  async function execute(variables: Variables): Promise<T> {
    controller?.abort();
    const own = ++generation;
    const current = controller = new AbortController();
    loading.value = true;
    error.value = undefined;
    try {
      const result = await request(client, variables, current.signal);
      if (own === generation) data.value = result;
      return result;
    } catch (failure) {
      if (own === generation) error.value = failure;
      throw failure;
    } finally { if (own === generation) loading.value = false; }
  }
  return { data, error, loading, execute, cancel };
}
