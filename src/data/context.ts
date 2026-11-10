/**
 * The abort signal of the request being served, for the data layer.
 *
 * Every data call is made as the App, with the App's key. The App's request
 * entry point may hand the data layer the request's abort signal with
 * `runWithAbortSignal(request.signal, next)`: when the caller goes away, data
 * calls of that request still waiting for one of the process's request slots
 * are dropped unsent (`DATA_ABORTED`, `notStarted`) and those in flight are
 * cancelled. Work that must outlive the request (timers, queues, fire-and-
 * forget follow-ups) runs in `runDetached`, which drops the signal. Ensure,
 * seed writes and `data.subscribe` never take a request's signal.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const SIGNAL_KEY = Symbol.for('tier0.sdk-v2.data.abort-signal');

// One store per process, shared across dev-server module reloads.
const globalStore = globalThis as typeof globalThis & {
  [SIGNAL_KEY]?: AsyncLocalStorage<AbortSignal | undefined>;
};
const storage = (globalStore[SIGNAL_KEY] ??= new AsyncLocalStorage<AbortSignal | undefined>());

/** Runs `fn` with `signal` as the abort signal of the data calls it makes. */
export function runWithAbortSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  return storage.run(signal, fn);
}

/** Runs `fn` outside the current request's abort signal: its data calls are not cancelled when that request is. */
export function runDetached<T>(fn: () => T): T {
  return storage.run(undefined, fn);
}

/** The abort signal of the request being served, if one was given. */
export function currentSignal(): AbortSignal | undefined {
  return storage.getStore();
}
