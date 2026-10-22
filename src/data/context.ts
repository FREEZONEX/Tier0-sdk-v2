/**
 * Request context for the data layer.
 *
 * The Tier0 App Gateway signs the current employee into
 * `X-Tier0-App-Data-Subject` on each business request. UNS uses it to narrow
 * App-key access to that employee (data rules, record leases). The data layer
 * forwards it only while serving that request: the App's request entry point
 * opens the context with `runWithRequestContext`, and ensure, seed writes and
 * `runAsApp(...)` background work never carry it.
 *
 * Given the `Request` itself, the context also carries its abort signal: when
 * the caller goes away, data calls still waiting for a request slot are
 * dropped unsent and those in flight are cancelled.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { UNS_V2_APP_DATA_SUBJECT_HEADER } from '../cloud-transport.js';

interface RequestContext {
  dataSubject?: string;
  signal?: AbortSignal;
}

// One store per process, shared across dev-server module reloads.
const STORAGE_KEY = Symbol.for('tier0.sdk-v2.data.request-context');
const globalStore = globalThis as typeof globalThis & {
  [STORAGE_KEY]?: AsyncLocalStorage<RequestContext | null>;
};
const storage = (globalStore[STORAGE_KEY] ??= new AsyncLocalStorage<RequestContext | null>());

/** Runs `fn` as part of the business request given (or only its headers, without abort). */
export function runWithRequestContext<T>(request: Request | Headers, fn: () => T): T {
  const headers = request instanceof Headers ? request : request.headers;
  const signal = request instanceof Headers ? undefined : request.signal;
  const dataSubject = headers.get(UNS_V2_APP_DATA_SUBJECT_HEADER)?.trim() || undefined;
  return storage.run({ ...(dataSubject ? { dataSubject } : {}), ...(signal ? { signal } : {}) }, fn);
}

/**
 * Runs `fn` as the App itself, outside any employee's request: use it for
 * work that outlives or is detached from the request (timers, queues, fire-
 * and-forget follow-ups). Its data calls carry no data subject.
 */
export function runAsApp<T>(fn: () => T): T {
  return storage.run(null, fn);
}

/** The data subject of the request being served, if any. */
export function currentDataSubject(): string | undefined {
  return storage.getStore()?.dataSubject;
}

/** The abort signal of the request being served, if it was given. */
export function currentSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}
