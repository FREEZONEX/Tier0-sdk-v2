/**
 * Request context for the data layer.
 *
 * The front door signs the current employee into `X-Tier0-Delegation` on each
 * business request. Backend uses it, together with the App's key,
 * to narrow App access to that employee (data rules, record leases). The SDK
 * forwards it as received, on every platform call, only while serving that
 * request: the App's request entry point opens the context with
 * `runWithRequestContext`, and ensure, seed writes and `runAsApp(...)`
 * background work never carry it. Apps on an API key use
 * `X-Tier0-App-Data-Subject` the same way.
 *
 * Given the `Request` itself, the context also carries its abort signal: when
 * the caller goes away, data calls still waiting for a request slot are
 * dropped unsent and those in flight are cancelled.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { UNS_V2_APP_DATA_SUBJECT_HEADER } from '../cloud-transport.js';
import { currentDelegation, DELEGATION_HEADER, REQUEST_CONTEXT_KEY, type RequestContext } from '../request-context.js';

// One store per process, shared across dev-server module reloads.
const globalStore = globalThis as typeof globalThis & {
  [REQUEST_CONTEXT_KEY]?: AsyncLocalStorage<RequestContext | null>;
};
const storage = (globalStore[REQUEST_CONTEXT_KEY] ??= new AsyncLocalStorage<RequestContext | null>());

/** Runs `fn` as part of the business request given (or only its headers, without abort). */
export function runWithRequestContext<T>(request: Request | Headers, fn: () => T): T {
  const headers = request instanceof Headers ? request : request.headers;
  const signal = request instanceof Headers ? undefined : request.signal;
  const dataSubject = headers.get(UNS_V2_APP_DATA_SUBJECT_HEADER)?.trim() || undefined;
  const delegation = headers.get(DELEGATION_HEADER)?.trim() || undefined;
  return storage.run({
    ...(dataSubject ? { dataSubject } : {}),
    ...(delegation ? { delegation } : {}),
    ...(signal ? { signal } : {}),
  }, fn);
}

/**
 * Runs `fn` as the App itself, outside any employee's request: use it for
 * work that outlives or is detached from the request (timers, queues, fire-
 * and-forget follow-ups). Its calls carry no data subject or delegation.
 */
export function runAsApp<T>(fn: () => T): T {
  return storage.run(null, fn);
}

/** The data subject of the request being served, if any. */
export function currentDataSubject(): string | undefined {
  return storage.getStore()?.dataSubject;
}

export { currentDelegation };

/** The abort signal of the request being served, if it was given. */
export function currentSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}
