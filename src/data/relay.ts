/**
 * `createChangeRelay`: one `data.subscribe` per server process, fanned out to
 * browsers as server-sent events on a route of the App.
 *
 *   const relay = createChangeRelay(data);
 *   // GET /api/changes, after the App authenticated the visitor:
 *   return relay.stream({
 *     filter: (change) => canSee(visitor, change),
 *     lastEventId: request.headers.get('Last-Event-ID'),
 *     signal: request.signal,
 *   });
 *
 * The upstream runs as the App and sees every change of the collections
 * granted to it; `filter` decides, per browser, what that visitor may know
 * about. It is called synchronously for every change, live or replayed, and
 * a filter that throws drops the change. Events carry identities only
 * (collection, record ID, revision, kind of change), never record data: the
 * browser reads what it shows through the App's own API, which applies the
 * App's rules.
 *
 * Browsers never open their own upstream: the Gateway limits open
 * subscriptions per workspace, not per visitor.
 *
 * Positions: browsers never see UNS cursors. Each upstream session has a
 * random epoch, and the relay numbers the changes it forwards `<epoch>.<seq>`;
 * that is the SSE `id`, sent first as an id-only frame on connect so every
 * browser has a resume point. A reconnect's `Last-Event-ID` is looked up in
 * the latest `bufferSize` changes of the current session: found, the changes
 * after it are replayed; anything else (another session, too old, forged)
 * answers that browser with `reset`. A session ends when UNS sends `reset`,
 * the upstream fails, or it closes `idleCloseMs` after the last browser left;
 * the next session has a new epoch, and connected browsers get a `reset`
 * carrying the new position. `reset` means the same as from `data.subscribe`:
 * changes may have been missed, reload what is shown. A failed upstream
 * reopens after `restartIntervalMs`, doubling per consecutive failure up to
 * `maxRestartIntervalMs`.
 *
 * Every browser stream ends after `maxStreamMs` (±10 %), so the browser
 * reconnects and the App's route authenticates it again.
 *
 * Frames: `event: change` with `{eventId, collection, change, recordId,
 * revision, occurredAt}` (`RelayedChange`), `event: reset` with `{reason}`,
 * a `: heartbeat` comment every `heartbeatMs`, and `retry: <retryMs>`.
 * `@tier0/sdk-v2/event-stream` reads them in the browser.
 */
import { randomUUID } from 'node:crypto';
import type { RecordChange, SubscribeOptions, SubscriptionEvent } from './subscribe.js';

export interface ChangeRelayOptions {
  /** Collections of the upstream; every declared collection by default. */
  collections?: SubscribeOptions['collections'];
  /** Changes kept for replay to reconnecting browsers. Default 1000. */
  bufferSize?: number;
  /** Close the upstream this long after the last browser left. Default 30 s. */
  idleCloseMs?: number;
  /** Wait before reopening a failed upstream; doubles per consecutive failure. Default 5 s. */
  restartIntervalMs?: number;
  /** Default 5 minutes. */
  maxRestartIntervalMs?: number;
  /** Default 15 s. */
  heartbeatMs?: number;
  /** A browser stream ends after this long (±10 %). Default 10 minutes. */
  maxStreamMs?: number;
  /** Browser reconnect delay, sent as the SSE `retry` field. Default 5 s. */
  retryMs?: number;
  logger?: Pick<Console, 'warn'>;
}

export interface ChangeRelayStreamOptions {
  /** Whether this browser gets the change; every change when absent. */
  filter?: (change: RecordChange) => boolean;
  /** The browser's `Last-Event-ID` header. */
  lastEventId?: string | null;
  /** Ends the stream, e.g. `request.signal`. */
  signal?: AbortSignal;
}

/** The `data` of a `change` frame. `eventId` is the relay's position, not a UNS cursor. */
export interface RelayedChange {
  eventId: string;
  collection: string;
  change: 'record' | 'delete';
  recordId: string;
  revision: number;
  occurredAt: number;
}

export interface ChangeRelay {
  /** An SSE response for one browser. */
  stream(options?: ChangeRelayStreamOptions): Response;
  /** Open browser streams. */
  readonly size: number;
}

const DEFAULTS = {
  bufferSize: 1000,
  idleCloseMs: 30_000,
  restartIntervalMs: 5_000,
  maxRestartIntervalMs: 300_000,
  heartbeatMs: 15_000,
  maxStreamMs: 600_000,
  retryMs: 5_000,
};

interface Subscriber {
  matches(change: RecordChange): boolean;
  send(chunk: string): void;
}

/** One upstream subscription's numbering of the changes it forwarded. */
interface Session {
  epoch: string;
  seq: number;
  /** Latest forwarded changes, oldest first. */
  buffer: { seq: number; change: RecordChange }[];
}

function changeFrame(change: RecordChange, eventId: string): string {
  const { collection, change: kind, recordId, revision, occurredAt } = change;
  const data: RelayedChange = { eventId, collection, change: kind, recordId, revision, occurredAt };
  return `event: change\nid: ${eventId}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A reset that also moves the browser to `position`, so its next reconnect resumes there. */
function resetFrame(reason: string, position: string): string {
  return `event: reset\nid: ${position}\ndata: ${JSON.stringify({ reason })}\n\n`;
}

function newSession(): Session {
  return { epoch: randomUUID().slice(0, 8), seq: 0, buffer: [] };
}

export function createChangeRelay(
  data: { subscribe(options: SubscribeOptions): AsyncIterable<SubscriptionEvent> },
  options: ChangeRelayOptions = {},
): ChangeRelay {
  const { collections, logger = console } = options;
  const { bufferSize, idleCloseMs, restartIntervalMs, maxRestartIntervalMs, heartbeatMs, maxStreamMs, retryMs } = { ...DEFAULTS, ...options };
  const subscribers = new Set<Subscriber>();
  let session = newSession();
  let upstream: AbortController | null = null;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const position = () => `${session.epoch}.${session.seq}`;

  /** Ends the session: browsers still connected reload and resume in the next one. */
  function resetAll(reason: string) {
    session = newSession();
    const chunk = resetFrame(reason, position());
    for (const subscriber of subscribers) subscriber.send(chunk);
  }

  function forward(change: RecordChange) {
    session.seq += 1;
    session.buffer.push({ seq: session.seq, change });
    if (session.buffer.length > bufferSize) session.buffer.splice(0, session.buffer.length - bufferSize);
    const chunk = changeFrame(change, position());
    for (const subscriber of subscribers) if (subscriber.matches(change)) subscriber.send(chunk);
  }

  async function run(controller: AbortController) {
    try {
      for await (const event of data.subscribe({ ...(collections ? { collections } : {}), signal: controller.signal })) {
        if (controller.signal.aborted) break;
        failures = 0;
        if (event.type === 'reset') resetAll(event.reason);
        else forward(event);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        failures += 1;
        logger.warn(`[change-relay] upstream failed (${failures} in a row):`, error instanceof Error ? error.message : error);
      }
    } finally {
      if (upstream === controller) upstream = null;
      if (!controller.signal.aborted) {
        // Changes during the outage are lost to this session.
        resetAll('upstream-failed');
        schedule();
      }
    }
  }

  function start() {
    startTimer = undefined;
    if (upstream || subscribers.size === 0) return;
    const controller = new AbortController();
    upstream = controller;
    // The upstream outlives the request that started it; data.subscribe never takes a request's signal.
    void run(controller);
  }

  function schedule() {
    if (upstream || startTimer !== undefined || subscribers.size === 0) return;
    const delay = failures === 0 ? 0 : Math.min(maxRestartIntervalMs, restartIntervalMs * 2 ** (failures - 1));
    startTimer = setTimeout(start, delay);
    startTimer.unref?.();
  }

  function join(subscriber: Subscriber) {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    subscribers.add(subscriber);
    schedule();
  }

  function release(subscriber: Subscriber) {
    if (!subscribers.delete(subscriber) || subscribers.size > 0) return;
    if (startTimer !== undefined) {
      clearTimeout(startTimer);
      startTimer = undefined;
    }
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      upstream?.abort();
      upstream = null;
      session = newSession();
    }, idleCloseMs);
    idleTimer.unref?.();
  }

  /** Frames that bring a browser from `lastEventId` to the current position. */
  function catchUp(matches: (change: RecordChange) => boolean, lastEventId: string | undefined): string[] {
    if (!lastEventId) return [];
    const [epoch, seqText] = lastEventId.split('.');
    const seq = Number(seqText);
    const oldest = session.buffer[0]?.seq ?? session.seq + 1;
    const known = epoch === session.epoch && Number.isInteger(seq) && seq <= session.seq && seq >= oldest - 1;
    if (!known) return [resetFrame('unknown-event-id', position())];
    return session.buffer
      .filter((entry) => entry.seq > seq && matches(entry.change))
      .map((entry) => changeFrame(entry.change, `${session.epoch}.${entry.seq}`));
  }

  return {
    get size() {
      return subscribers.size;
    },
    stream({ filter, lastEventId, signal } = {}) {
      const matches = (change: RecordChange) => {
        if (!filter) return true;
        try {
          return filter(change) === true;
        } catch (error) {
          logger.warn('[change-relay] filter failed; change dropped:', error instanceof Error ? error.message : error);
          return false;
        }
      };
      const encoder = new TextEncoder();
      let subscriber: Subscriber | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      let close = () => undefined as void;

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          close = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            clearTimeout(expiry);
            signal?.removeEventListener('abort', close);
            if (subscriber) release(subscriber);
            try {
              controller.close();
            } catch {
              // Already closed by the consumer.
            }
          };
          const send = (chunk: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              close();
            }
          };
          if (signal?.aborted) {
            closed = true;
            controller.close();
            return;
          }
          send(`retry: ${retryMs}\n\n`);
          for (const chunk of catchUp(matches, lastEventId ?? undefined)) send(chunk);
          // An id-only frame dispatches nothing; it moves the browser's resume point to now.
          send(`id: ${position()}\n\n`);
          subscriber = { matches, send };
          join(subscriber);
          heartbeat = setInterval(() => send(': heartbeat\n\n'), heartbeatMs);
          heartbeat.unref?.();
          expiry = setTimeout(close, maxStreamMs * (0.9 + Math.random() * 0.2));
          expiry.unref?.();
          signal?.addEventListener('abort', close, { once: true });
        },
        cancel() {
          close();
        },
      });

      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    },
  };
}
