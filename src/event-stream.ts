/**
 * A server-sent event stream over `fetch`, for browsers. `EventSource` gives up
 * for good on any HTTP error, so a 503 from a sleeping App or a restarting node
 * agent (design 21.1) would end it. This one reads the error and acts on it:
 *
 * - `sbx_sleeping`, `sbx_starting`: stop, and reconnect on the runtime's
 *   `resumed`. Without the runtime `sbx_sleeping` ends the stream and
 *   `sbx_starting` waits `retry_after_ms`.
 * - an authorization failure: reported to the runtime, then as above. A
 *   successful reauthorization also fires `resumed`.
 * - `node_restarting`, `upstream_error` and any other retryable failure, and a
 *   broken connection: reconnect by itself after `retry_after_ms` or a backoff,
 *   resuming from `Last-Event-ID`.
 * - a non-retryable failure: ends the stream.
 *
 * While the runtime says `sleeping` nothing is sent: those requests would not
 * wake the App anyway.
 */
import { getPageRuntime, onPageRuntime, isAuthErrorCode, isAppSleeping, readPlatformError, reportAuthError, type PlatformError } from './page-runtime.js';
import { parseServerSentEvents, type ServerSentEvent } from './uns-v2/sse.js';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** A connection alive this long resets the backoff. */
const HEALTHY_CONNECTION_MS = 30_000;
/**
 * A paused stream looks again this often while the runtime still says
 * `running`: a routing race can answer `sbx_sleeping` for a running App, and
 * then no `resumed` ever comes. Such a request cannot wake anything.
 */
const PAUSE_RECHECK_MS = 30_000;

export interface EventStreamOptions {
  url: string;
  headers?: Record<string, string>;
  lastEventId?: string;
  fetch?: typeof globalThis.fetch;
  onEvent(event: ServerSentEvent): void;
  /**
   * The stream is back after a pause for the App's sleep or an authorization
   * failure. Events may have been missed, resume position or not.
   */
  onResume?(): void;
  /** The stream ended for good; it does not reconnect. Not called after `close()`. */
  onClose?(error: EventStreamError): void;
  /** Reconnect when nothing, not even a heartbeat, arrives for this long. Off by default. */
  idleTimeoutMs?: number;
}

export interface EventStream {
  close(): void;
}

export class EventStreamError extends Error {
  constructor(readonly status: number, readonly code: string | undefined) {
    super(`Event stream refused with HTTP ${status}${code ? ` (${code})` : ''}.`);
    this.name = 'EventStreamError';
  }
}

type Outcome =
  | { next: 'reconnect'; afterMs?: number }
  | { next: 'pause' }
  | { next: 'end'; error: EventStreamError };

function classify(status: number, failure: PlatformError | undefined): Outcome {
  const code = failure?.code;
  const runtime = getPageRuntime() !== undefined;
  if (isAuthErrorCode(code)) {
    reportAuthError(code);
    return runtime ? { next: 'pause' } : { next: 'end', error: new EventStreamError(status, code) };
  }
  if (code === 'sbx_sleeping' || code === 'sbx_starting' || code === 'sbx_start_failed') {
    if (runtime) return { next: 'pause' };
    if (code !== 'sbx_starting') return { next: 'end', error: new EventStreamError(status, code) };
  }
  if (failure?.retryable) return { next: 'reconnect', afterMs: failure.retryAfterMs };
  // Not ours to classify: an edge proxy's 5xx passes, a route's 4xx is final.
  if (!failure && status >= 500) return { next: 'reconnect' };
  return { next: 'end', error: new EventStreamError(status, code) };
}

export function openEventStream(options: EventStreamOptions): EventStream {
  const { url, onEvent, onResume, onClose, idleTimeoutMs } = options;
  let lastEventId = options.lastEventId;
  let closed = false;
  let paused = isAppSleeping();
  let resumedFromPause = false;
  let failures = 0;
  let resumes = 0;
  let connection: AbortController | undefined;
  let wake: (() => void) | undefined;

  const sleep = (ms?: number) => new Promise<void>((resolve) => {
    const timer = ms === undefined ? undefined : setTimeout(() => done(), ms);
    const done = () => {
      clearTimeout(timer);
      wake = undefined;
      resolve();
    };
    wake = done;
  });

  const offSleeping = onPageRuntime('sleeping', () => {
    paused = true;
    connection?.abort();
    wake?.();
  });
  const offResumed = onPageRuntime('resumed', () => {
    if (paused) resumedFromPause = true;
    paused = false;
    resumes += 1;
    wake?.();
  });

  function backoff(): number {
    failures += 1;
    const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (failures - 1));
    return ceiling / 2 + Math.random() * (ceiling / 2);
  }

  async function consume(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const openedAt = Date.now();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (idleTimeoutMs === undefined) return;
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), idleTimeoutMs);
    };
    arm();
    try {
      for await (const event of parseServerSentEvents(body)) {
        arm();
        if (Date.now() - openedAt >= HEALTHY_CONNECTION_MS) failures = 0;
        if ('comment' in event) continue;
        if (event.id !== undefined) lastEventId = event.id;
        if ('event' in event) onEvent(event);
      }
    } finally {
      clearTimeout(idle);
    }
  }

  async function connect(): Promise<Outcome> {
    const controller = new AbortController();
    connection = controller;
    const headers: Record<string, string> = { ...options.headers, Accept: 'text/event-stream' };
    if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId;
    try {
      const response = await (options.fetch ?? globalThis.fetch)(url, { headers, cache: 'no-store', signal: controller.signal });
      const type = response.headers.get('content-type') ?? '';
      if (response.ok && /^text\/event-stream\b/i.test(type) && response.body) {
        if (resumedFromPause) {
          resumedFromPause = false;
          onResume?.();
        }
        await consume(response.body, controller);
        return { next: 'reconnect' };
      }
      const failure = await readPlatformError(response);
      await response.body?.cancel().catch(() => undefined);
      return classify(response.status, failure);
    } catch {
      return { next: 'reconnect' };
    } finally {
      connection = undefined;
    }
  }

  async function run(): Promise<void> {
    while (!closed) {
      if (paused) {
        await sleep(getPageRuntime()?.getState() === 'running' ? PAUSE_RECHECK_MS : undefined);
        if (getPageRuntime()?.getState() === 'running' && !closed) {
          resumedFromPause = true;
          paused = false;
        }
        continue;
      }
      const seenResumes = resumes;
      const outcome = await connect();
      if (closed) return;
      if (outcome.next === 'end') {
        close();
        onClose?.(outcome.error);
        return;
      }
      if (outcome.next === 'pause') {
        // A `resumed` that arrived while the refusal was on its way already happened.
        if (resumes === seenResumes) paused = true;
        else resumedFromPause = true;
        continue;
      }
      if (!paused) await sleep(outcome.afterMs ?? backoff());
    }
  }

  function close(): void {
    closed = true;
    offSleeping();
    offResumed();
    connection?.abort();
    wake?.();
  }

  void run();
  return { close };
}
