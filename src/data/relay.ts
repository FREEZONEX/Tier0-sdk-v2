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
 * Positions: browsers never see UNS cursors. The relay numbers the changes it
 * forwards `<epoch>.<seq>`; that is the SSE `id`. A browser gets a position
 * (an id-only frame, repeated as its heartbeat) only once the upstream can
 * deliver every change after it:
 *
 * - Cold start: until the upstream's first connection streams, browsers get
 *   no position. Then each of them gets `reset` (`upstream-started`) with a
 *   position, so a page that read its data before the upstream existed
 *   reads it again.
 * - The relay keeps the last UNS position. When the upstream fails, or closes
 *   `idleCloseMs` after the last browser left, it reopens from that position
 *   in the same epoch: nothing is missed and connected browsers get no reset.
 * - Only a `reset` from the upstream (`CURSOR_EXPIRED`, `SCOPE_CHANGED`,
 *   `COLLECTION_RECREATED`) starts a new epoch. Connected browsers then get
 *   that `reset`, with a new position, once the upstream streams again.
 *
 * A reconnect's `Last-Event-ID` is looked up in the latest `bufferSize`
 * changes of the current epoch: found, the changes after it are replayed;
 * anything else (another epoch, too old, forged) answers that browser with
 * `reset` (`unknown-event-id`). `reset` means the same as from
 * `data.subscribe`: changes may have been missed, reload what is shown.
 *
 * When the upstream cannot connect (e.g. 429 over the subscription limit,
 * `APP_NOT_READY`, or a failure that ends `data.subscribe`), the relay goes to
 * status `unavailable`: `onStatus` hears it, `logger.warn` logs it once, and
 * every browser stream gets `event: unavailable` with `{reason}`. The upstream
 * keeps retrying; when it streams again the status is `ready`, and browsers
 * that were waiting for a position get it as described above. A failure that
 * ends `data.subscribe` reopens after `restartIntervalMs`, doubling per
 * consecutive failure up to `maxRestartIntervalMs`.
 *
 * Every browser stream ends after `maxStreamMs` (±10 %), so the browser
 * reconnects and the App's route authenticates it again. Reconnect timing is
 * the browser client's: `openEventStream` (`@tier0/sdk-v2/event-stream`)
 * handles platform errors, the App's sleep and hidden pages itself, so the
 * relay sends no `retry:` field.
 *
 * Frames: `event: change` with `{eventId, collection, change, recordId,
 * revision, occurredAt}` (`RelayedChange`), `event: reset` with `{reason}`,
 * `event: unavailable` with `{reason}`, and every `heartbeatMs` an id-only
 * frame with the current position (a `: heartbeat` comment while the browser
 * has none), so an idle browser's resume point stays inside the buffer.
 */
import { randomUUID } from 'node:crypto';
import type { DataError } from './error.js';
import type { RecordChange, SubscribeObserver, SubscribeOptions, SubscriptionEvent } from './subscribe.js';

/** `idle`: no upstream; `connecting`: opening it; `ready`: it streams; `unavailable`: it cannot connect and keeps retrying. */
export type ChangeRelayStatus = 'idle' | 'connecting' | 'ready' | 'unavailable';

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
  /** Status changes; `error` is the failure behind `unavailable`. */
  onStatus?: (status: ChangeRelayStatus, error?: unknown) => void;
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
  readonly status: ChangeRelayStatus;
}

/** The upstream as the relay uses it: `data.subscribe` with its internal observer. */
export interface ChangeRelaySource {
  subscribe(options: SubscribeOptions, observer?: SubscribeObserver): AsyncIterable<SubscriptionEvent>;
}

const DEFAULTS = {
  bufferSize: 1000,
  idleCloseMs: 30_000,
  restartIntervalMs: 5_000,
  maxRestartIntervalMs: 300_000,
  heartbeatMs: 15_000,
  maxStreamMs: 600_000,
};

interface Subscriber {
  matches(change: RecordChange): boolean;
  send(chunk: string): void;
  /** Has a position; until then it gets no change frames and, once positioned, a reset with `resetReason`. */
  positioned: boolean;
  resetReason: string;
}

/** One epoch's numbering of the changes the relay forwarded. */
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

function unavailableFrame(reason: string): string {
  return `event: unavailable\ndata: ${JSON.stringify({ reason })}\n\n`;
}

function reasonOf(error: unknown): string {
  const value = error as Partial<DataError> | undefined;
  return typeof value?.code === 'string' ? value.code : 'upstream-failed';
}

function newSession(): Session {
  return { epoch: randomUUID().slice(0, 8), seq: 0, buffer: [] };
}

export function createChangeRelay(data: ChangeRelaySource, options: ChangeRelayOptions = {}): ChangeRelay {
  const { collections, onStatus, logger = console } = options;
  const { bufferSize, idleCloseMs, restartIntervalMs, maxRestartIntervalMs, heartbeatMs, maxStreamMs } = { ...DEFAULTS, ...options };
  const subscribers = new Set<Subscriber>();
  let session = newSession();
  /** The last UNS position: the upstream reopens from it. */
  let cursor: string | undefined;
  /** The current upstream connection streams. */
  let live = false;
  let status: ChangeRelayStatus = 'idle';
  let unavailableReason = 'upstream-failed';
  let upstream: AbortController | null = null;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const position = () => `${session.epoch}.${session.seq}`;
  /** Every change after the current position will reach the browsers. */
  const positionable = () => cursor !== undefined || live;

  function setStatus(next: ChangeRelayStatus, error?: unknown) {
    if (next === status) return;
    status = next;
    if (next === 'unavailable') {
      unavailableReason = reasonOf(error);
      logger.warn(`[change-relay] upstream unavailable (${unavailableReason}); retrying:`, error instanceof Error ? error.message : error);
      for (const subscriber of subscribers) subscriber.send(unavailableFrame(unavailableReason));
    }
    try {
      onStatus?.(next, error);
    } catch {
      // A status listener cannot stop the relay.
    }
  }

  /** Gives waiting browsers their reset and position, once the upstream can deliver what follows. */
  function positionWaiting() {
    if (!positionable()) return;
    for (const subscriber of subscribers) {
      if (subscriber.positioned) continue;
      subscriber.positioned = true;
      subscriber.send(resetFrame(subscriber.resetReason, position()));
    }
  }

  function forward(change: RecordChange) {
    session.seq += 1;
    session.buffer.push({ seq: session.seq, change });
    if (session.buffer.length > bufferSize) session.buffer.splice(0, session.buffer.length - bufferSize);
    const chunk = changeFrame(change, position());
    for (const subscriber of subscribers) if (subscriber.positioned && subscriber.matches(change)) subscriber.send(chunk);
  }

  /** The upstream reset: a new epoch, and every browser reloads once the upstream streams again. */
  function restartEpoch(reason: string) {
    session = newSession();
    cursor = undefined;
    live = false;
    for (const subscriber of subscribers) {
      subscriber.positioned = false;
      subscriber.resetReason = reason;
    }
  }

  async function run(controller: AbortController) {
    const observer: SubscribeObserver = {
      connected() {
        if (controller.signal.aborted) return;
        live = true;
        failures = 0;
        setStatus('ready');
        positionWaiting();
      },
      position(eventId) {
        if (!controller.signal.aborted) cursor = eventId;
      },
      retrying(error) {
        if (controller.signal.aborted) return;
        live = false;
        setStatus('unavailable', error);
      },
    };
    live = false;
    setStatus('connecting');
    try {
      const subscription = data.subscribe({
        ...(collections ? { collections } : {}),
        ...(cursor === undefined ? {} : { lastEventId: cursor }),
        signal: controller.signal,
      }, observer);
      for await (const event of subscription) {
        if (controller.signal.aborted) break;
        if (event.type === 'reset') restartEpoch(event.reason);
        else forward(event);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        failures += 1;
        live = false;
        setStatus('unavailable', error);
      }
    } finally {
      if (upstream === controller) upstream = null;
      live = false;
      // Reopens from the last UNS position: same epoch, nothing missed.
      if (!controller.signal.aborted) schedule();
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
      // The epoch, buffer and UNS position stay: the next browser resumes in the same epoch.
      upstream?.abort();
      upstream = null;
      live = false;
      setStatus('idle');
    }, idleCloseMs);
    idleTimer.unref?.();
  }

  /** Replays after `lastEventId`; false when it is not a position of the current epoch's buffer. */
  function catchUp(subscriber: Subscriber, lastEventId: string | undefined): boolean {
    if (!lastEventId) return false;
    const [epoch, seqText] = lastEventId.split('.');
    const seq = Number(seqText);
    const oldest = session.buffer[0]?.seq ?? session.seq + 1;
    if (epoch !== session.epoch || !Number.isInteger(seq) || seq > session.seq || seq < oldest - 1) return false;
    for (const entry of session.buffer) {
      if (entry.seq > seq && subscriber.matches(entry.change)) subscriber.send(changeFrame(entry.change, `${session.epoch}.${entry.seq}`));
    }
    return true;
  }

  return {
    get size() {
      return subscribers.size;
    },
    get status() {
      return status;
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
          const current: Subscriber = { matches, send, positioned: false, resetReason: 'upstream-started' };
          subscriber = current;
          if (positionable()) {
            current.positioned = true;
            // A known position replays what followed; anything else reloads.
            if (catchUp(current, lastEventId ?? undefined)) send(`id: ${position()}\n\n`);
            else if (lastEventId) send(resetFrame('unknown-event-id', position()));
            // A first connect: an id-only frame dispatches nothing and gives the browser its resume point.
            else send(`id: ${position()}\n\n`);
          } else if (lastEventId) {
            current.resetReason = 'unknown-event-id';
          }
          if (status === 'unavailable') send(unavailableFrame(unavailableReason));
          join(current);
          heartbeat = setInterval(() => send(current.positioned ? `id: ${position()}\n\n` : ': heartbeat\n\n'), heartbeatMs);
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
