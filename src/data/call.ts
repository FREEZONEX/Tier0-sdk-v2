/**
 * One UNS call of the data layer. The SDK's UNS client resolves host and key,
 * sends the request and checks the envelope; this adds the App runtime policy
 * around it and turns every failure into a `DataError`:
 *
 * - binds the employee data subject and the abort signal of the current call;
 * - gives every write that takes an idempotency key a fresh UUID unless the
 *   caller set one, and keeps it for the retries of that call;
 * - sends at most MAX_CONCURRENT_CALLS requests per process at a time; the
 *   rest wait in line;
 * - resends a failed request (same body, same key) at most MAX_RETRIES times,
 *   only when its `retry.safe` says so, after `retry.afterMs` or a jittered
 *   exponential backoff. UNS sets `retry.safe` (429 overload, 503 temporary
 *   failure, a rolled-back write …); for failures without a UNS answer the
 *   client sets it for reads only (timeout, network, ingress 502/503/504), so
 *   a write whose outcome is unknown is never resent here;
 * - bounds the whole call, queueing, attempts and waits included, by one
 *   deadline from its start. A call that runs out of time or is aborted
 *   while it waits in line leaves the queue and is never sent
 *   (`DATA_OVERLOADED` / `DATA_ABORTED`, `execution: notStarted`).
 *
 * `openStream` opens one `records:subscribe` event stream for `data.subscribe`,
 * which owns reconnects.
 */
import { randomUUID } from 'node:crypto';
import { HttpClient, type ClientConfig } from '../openapi/client.js';
import {
  UnsV2ClientCore,
  UnsV2Error,
  type UnsV2RecordSubscribeRequest,
  type UnsV2SubscriptionEvent,
} from '../uns-v2/client.js';
import { UNS_V2_OPERATIONS, type UnsV2OperationName, type UnsV2Request } from '../uns-v2/generated.js';
import { DataError, toDataError } from './error.js';

/** Whole call, from its start. The gateway gives UNS at most 20 s, so a data call ends within 25 s. */
export const DEFAULT_DATA_TIMEOUT_MS = 25_000;
/** Data requests in flight per process, across every data client. */
export const MAX_CONCURRENT_CALLS = 6;
/** Resends of one call after its first attempt. */
export const MAX_RETRIES = 2;
/** A retry waits at most this long; a longer `retry.afterMs` surfaces the error instead. */
export const MAX_RETRY_WAIT_MS = 5_000;
const BACKOFF_BASE_MS = 250;

export interface CallOptions {
  /** Employee assertion forwarded from the current business request. */
  dataSubject?: string;
  /** Abort of the current business request: a queued call leaves the queue, an in-flight one is cancelled. */
  signal?: AbortSignal;
}

/** Sends one operation and resolves with the envelope's `data`. */
export type DataCall = <T>(operation: UnsV2OperationName, request: Record<string, unknown>, options?: CallOptions) => Promise<T>;

/**
 * Opens one `records:subscribe` stream (outside the concurrency gate: it is
 * long-lived and holds no UNS connection while it waits). Failures are DataErrors.
 */
export type DataOpenStream = (
  request: UnsV2RecordSubscribeRequest,
  options: CallOptions & { lastEventId?: string; signal: AbortSignal },
) => AsyncGenerator<UnsV2SubscriptionEvent>;

/** Why a waiter left the queue without a slot. */
class Abandoned extends Error {}

/** FIFO counting semaphore whose waiters can leave the line. */
class Gate {
  private active = 0;
  private readonly waiting: { grant: () => void }[] = [];

  constructor(private readonly limit: number) {}

  /** Runs `fn` with a slot; rejects with Abandoned if `signal` aborts while still waiting. */
  async run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.active < this.limit) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          grant: () => {
            signal.removeEventListener('abort', leave);
            resolve();
          },
        };
        const leave = () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new Abandoned());
        };
        if (signal.aborted) return leave();
        signal.addEventListener('abort', leave, { once: true });
        this.waiting.push(waiter);
      });
    }
    try {
      return await fn();
    } finally {
      // Hand the slot straight to the next waiter, so the count never dips below the queue.
      const next = this.waiting.shift();
      if (next) next.grant();
      else this.active -= 1;
    }
  }
}

// One gate per process, shared across data clients and dev-server module reloads.
const GATE_KEY = Symbol.for('tier0.sdk-v2.data.call-gate/2');
const globalGate = globalThis as typeof globalThis & { [GATE_KEY]?: Gate };
const gate = (globalGate[GATE_KEY] ??= new Gate(MAX_CONCURRENT_CALLS));

/** Wait before resend `attempt` (1-based), or undefined when the error must surface. */
export function retryDelay(error: UnsV2Error, attempt: number): number | undefined {
  if (!error.retry.safe || attempt > MAX_RETRIES) return undefined;
  if (error.retry.afterMs !== undefined) return error.retry.afterMs <= MAX_RETRY_WAIT_MS ? error.retry.afterMs : undefined;
  const ceiling = Math.min(MAX_RETRY_WAIT_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/** Resolves after `ms`, or early (false) when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve(!signal.aborted);
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export function createDataTransport(config: ClientConfig): { call: DataCall; openStream: DataOpenStream } {
  const http = new HttpClient(config);
  const resolve = () => http;
  const timeoutMs = config.transportTimeoutMs ?? DEFAULT_DATA_TIMEOUT_MS;
  const transport = { transportTimeoutMs: timeoutMs };
  const app = new UnsV2ClientCore(resolve, transport);

  function assertConfigured() {
    let problem: string | undefined;
    try {
      http.getBaseURL();
      if (!http.getApiKey()?.trim()) problem = 'TIER0_API_KEY is not set';
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem) {
      throw new DataError({
        message: `${problem}. The platform injects TIER0_API_HOST and TIER0_API_KEY in Preview and deployments; for local development set them before starting the App.`,
        status: 503,
        code: 'DATA_NOT_CONFIGURED',
      });
    }
  }

  // The SDK binds a data subject to one client; App-level calls use the shared one without it.
  const coreFor = (dataSubject: string | undefined) =>
    dataSubject ? new UnsV2ClientCore(resolve, { ...transport, unsV2AppDataSubject: dataSubject }) : app;

  async function call<T>(operation: UnsV2OperationName, request: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
    assertConfigured();
    const key = UNS_V2_OPERATIONS[operation].idempotencyKey
      ? (typeof request.idempotencyKey === 'string' ? request.idempotencyKey : randomUUID())
      : undefined;
    const body = key === undefined || request.idempotencyKey !== undefined ? request : { ...request, idempotencyKey: key };
    const deadline = Date.now() + timeoutMs;
    // Aborts when the call runs out of time or its business request is aborted.
    const stop = new AbortController();
    const expire = setTimeout(() => stop.abort(), timeoutMs);
    const relay = () => stop.abort();
    options.signal?.addEventListener('abort', relay, { once: true });
    if (options.signal?.aborted) stop.abort();
    const notSent = (attempts: number) => new DataError({
      ...(options.signal?.aborted
        ? { message: `The data call ${operation} was aborted before it was sent.`, status: 499, code: 'DATA_ABORTED' }
        : {
          message: `The data call ${operation} waited ${timeoutMs} ms for one of the ${MAX_CONCURRENT_CALLS} request slots of this process and was not sent.`,
          status: 503,
          code: 'DATA_OVERLOADED',
        }),
      execution: 'notStarted',
      retry: { safe: !options.signal?.aborted },
      attempts,
      idempotencyKey: key,
    });
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const response = await gate.run(() => {
            // Each attempt gets the time left of the call as its transport deadline.
            const remaining = Math.max(1, deadline - Date.now());
            const core = new UnsV2ClientCore(resolve, {
              transportTimeoutMs: remaining,
              ...(options.dataSubject ? { unsV2AppDataSubject: options.dataSubject } : {}),
            });
            // In flight, only the business request's abort cancels; the transport deadline covers the time.
            return core.call(operation, body as UnsV2Request<typeof operation>, { signal: options.signal });
          }, stop.signal);
          return response.data as T;
        } catch (error) {
          if (error instanceof Abandoned) throw notSent(attempt - 1);
          if (!(error instanceof UnsV2Error)) throw error;
          const delay = retryDelay(error, attempt);
          if (delay === undefined || Date.now() + delay >= deadline || !(await pause(delay, stop.signal))) {
            throw toDataError(error, attempt, key);
          }
        }
      }
    } finally {
      clearTimeout(expire);
      options.signal?.removeEventListener('abort', relay);
    }
  }

  async function* openStream(
    request: UnsV2RecordSubscribeRequest,
    options: CallOptions & { lastEventId?: string; signal: AbortSignal },
  ): AsyncGenerator<UnsV2SubscriptionEvent> {
    assertConfigured();
    try {
      yield* coreFor(options.dataSubject).subscribeRecords(request, options);
    } catch (error) {
      throw error instanceof UnsV2Error ? toDataError(error) : error;
    }
  }

  return { call, openStream };
}
