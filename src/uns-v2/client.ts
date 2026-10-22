import {
  CloudTransport,
  CloudTransportError,
  UNS_V2_MAX_REQUEST_BYTES,
  type CloudTransportConfig,
} from '../cloud-transport.js';
import { getClient, type HttpClient, type RequestOptions } from '../openapi/client.js';
import { decodeUnsV2JSON, encodeUnsV2JSON } from './codec.js';
import { parseServerSentEvents, ServerSentEventsError } from './sse.js';
import {
  UNS_V2_OPERATIONS,
  UNS_V2_STREAM_OPERATIONS,
  type CloudRecordSubscribeReq,
  type UnsV2OperationName,
  type UnsV2StreamOperationName,
  type UnsV2Operations,
  type UnsV2Request,
  type UnsV2Response,
} from './generated.js';

type RecordValue = Record<string, unknown>;

/**
 * How far a failed request got. `unknown` only for a mutation whose commit
 * cannot be confirmed; a read is never `unknown`.
 */
export type UnsV2Execution = 'notStarted' | 'rolledBack' | 'committed' | 'unknown';
export const UNS_V2_EXECUTIONS: readonly UnsV2Execution[] = ['notStarted', 'rolledBack', 'committed', 'unknown'];

/** Whether the identical request (same idempotency key) may be sent again, and after how long. */
export interface UnsV2Retry {
  safe: boolean;
  afterMs?: number;
}

/** Generated POST operations, or a GET event stream such as `recordSubscribe`. */
export type UnsV2ErrorOperation = UnsV2OperationName | UnsV2StreamOperationName;

export interface UnsV2ErrorInfo {
  status?: number;
  operation: UnsV2ErrorOperation;
  code: string;
  requestId?: string;
  execution: UnsV2Execution;
  retry: UnsV2Retry;
  opId?: string;
  path?: string;
  details?: RecordValue[];
  repair?: string;
  reason?: string;
  queryId?: string;
  /** The error envelope's `data`, verbatim; stable access codes such as `data.reason` live here. */
  data?: unknown;
}

/**
 * A failed UNS v2 call. `execution` and `retry` come from the error body; for
 * failures without one (timeout, network, invalid response) the SDK fills them
 * like the gateway does: a read `rolledBack` and safe to resend, a mutation
 * `unknown` and not safe. This client never retries; it exposes the advice.
 */
export class UnsV2Error extends Error implements UnsV2ErrorInfo {
  readonly status?: number;
  readonly operation: UnsV2ErrorOperation;
  readonly code: string;
  readonly requestId?: string;
  readonly execution: UnsV2Execution;
  readonly retry: UnsV2Retry;
  readonly opId?: string;
  readonly path?: string;
  readonly details?: RecordValue[];
  readonly repair?: string;
  readonly reason?: string;
  readonly queryId?: string;
  readonly data?: unknown;

  constructor(message: string, info: UnsV2ErrorInfo) {
    super(message);
    this.name = 'UnsV2Error';
    Object.assign(this, info);
    this.status = info.status;
    this.operation = info.operation;
    this.code = info.code;
    this.execution = info.execution;
    this.retry = info.retry;
  }

  get outcomeUnknown(): boolean {
    return this.execution === 'unknown';
  }
}

/**
 * `execution: "unknown"`: a mutation may have committed. Reconcile (read back,
 * or replay with the same idempotency key when `retry.safe`) before acting again.
 */
export class UnsV2OutcomeUnknownError extends UnsV2Error {
  constructor(message: string, info: UnsV2ErrorInfo) {
    super(message, info);
    this.name = 'UnsV2OutcomeUnknownError';
  }
}

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resourcePath(operation: { path: string; readonly pathParams: readonly string[] }, request: unknown): string {
  let path = operation.path;
  for (const key of operation.pathParams) {
    const value = record(request) && Object.prototype.hasOwnProperty.call(request, key) ? request[key] : undefined;
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 ||
        value === '.' || value === '..' || /[/\\\u0000-\u001f\u007f]/.test(value)) {
      throw new TypeError(`Tier0 SDK: invalid UNS v2 path identity ${key}.`);
    }
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  return path;
}

function afterMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** The wire error object (an envelope's `error`, a batch item's `error`); undefined when it is not one. */
export function parseUnsV2Fault(value: unknown): Omit<UnsV2ErrorInfo, 'status' | 'operation' | 'requestId' | 'data'> | undefined {
  if (!record(value) || typeof value.code !== 'string' || !Array.isArray(value.details) ||
      !UNS_V2_EXECUTIONS.includes(value.execution as UnsV2Execution) ||
      !record(value.retry) || typeof value.retry.safe !== 'boolean') return undefined;
  const wait = afterMs(value.retry.afterMs);
  return {
    code: value.code,
    execution: value.execution as UnsV2Execution,
    retry: { safe: value.retry.safe, ...(wait === undefined ? {} : { afterMs: wait }) },
    opId: typeof value.opId === 'string' ? value.opId : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
    details: value.details.every(record) ? value.details : undefined,
    repair: typeof value.repair === 'string' ? value.repair : undefined,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    queryId: typeof value.queryId === 'string' ? value.queryId : undefined,
  };
}

function errorInfo(value: unknown, status: number, operation: UnsV2ErrorOperation): UnsV2ErrorInfo | undefined {
  if (!record(value)) return undefined;
  const fault = parseUnsV2Fault(value.error);
  if (!fault) return undefined;
  return {
    ...fault,
    status,
    operation,
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    data: value.data ?? undefined,
  };
}

/**
 * Builds the error for a failure without a UNS error body. The gateway's rule
 * applies: a read is `rolledBack` (safe to resend when `safeRead`), a mutation
 * `unknown` and not safe. `notStarted` overrides both for answers that prove
 * the request never reached UNS.
 */
function localError(
  message: string,
  operation: UnsV2ErrorOperation,
  mutation: boolean,
  code: string,
  status?: number,
  safeRead = true,
  extra: { notStarted?: boolean; afterMs?: number } = {},
): UnsV2Error {
  const info: UnsV2ErrorInfo = {
    status,
    operation,
    code,
    execution: extra.notStarted ? 'notStarted' : mutation ? 'unknown' : 'rolledBack',
    retry: { safe: !mutation && safeRead, ...(extra.afterMs === undefined || mutation ? {} : { afterMs: extra.afterMs }) },
  };
  return info.execution === 'unknown' ? new UnsV2OutcomeUnknownError(message, info) : new UnsV2Error(message, info);
}

/** `Retry-After` as delay-seconds or an HTTP date, in milliseconds from now. */
function retryAfterMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * UNS v2 routes answer every error with the envelope, so a 4xx whose body is
 * no envelope at all comes from an intermediary (edge 401 / 413 page) that
 * never forwarded the request; 408 is the exception, the request may have
 * been forwarded.
 */
const rejectedBeforeUns = (status: number) => status >= 400 && status < 500 && status !== 408;

/** Contract limits of one `records:subscribe` stream. */
export const UNS_V2_SUBSCRIBE_MAX_COLLECTIONS = 64;
export const UNS_V2_SUBSCRIBE_MAX_RECORD_IDS = 100;
const EVENT_ID_MAX_LENGTH = 8192;

/**
 * Rejects a resume position that cannot be an event id (1–8192 visible ASCII
 * characters), such as a `Last-Event-ID` with CR/LF taken from a browser:
 * sent as a header it would fail every connection.
 */
export function assertEventId(value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > EVENT_ID_MAX_LENGTH || !/^[\x21-\x7e]+$/.test(value)) {
    throw new TypeError(`Tier0 SDK: lastEventId must be 1–${EVENT_ID_MAX_LENGTH} visible ASCII characters.`);
  }
}

/**
 * Query of `records:subscribe`; the resume position travels as `lastEventId`
 * (the `Last-Event-ID` header). Without `collectionIds` the stream covers every
 * collection the caller may read (an App key: every collection granted to the App).
 */
export type UnsV2RecordSubscribeRequest = Pick<CloudRecordSubscribeReq, 'collectionIds' | 'recordIds'>;

/**
 * A committed record change. Events carry identities only: read the record to
 * see its data. `restricted`: the collection has employee data rules, so who
 * may see this record depends on the employee (see `data.subscribe`).
 */
export interface UnsV2RecordChangeEvent {
  type: 'change';
  /** Stream position (also the frame id); resume after it with `lastEventId`. */
  eventId: string;
  collectionId: string;
  recordId: string;
  revision: number;
  change: 'record' | 'delete';
  occurredAt: number;
  restricted: boolean;
}

export type UnsV2SubscriptionEvent =
  | UnsV2RecordChangeEvent
  /** Sent on connect and every 15 s; `eventId` is the current position, resumable like a change's. */
  | { type: 'heartbeat'; eventId?: string }
  /**
   * The server closes the stream after it. `CURSOR_EXPIRED`: the position is
   * outside the 24 h retention; `SCOPE_CHANGED`: access narrowed. Reload, then
   * subscribe again without `lastEventId`.
   */
  | { type: 'reset'; reason: string; message?: string };

function changeEvent(value: unknown): UnsV2RecordChangeEvent | undefined {
  if (!record(value) || typeof value.eventId !== 'string' || typeof value.collectionId !== 'string' ||
      typeof value.recordId !== 'string' || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) ||
      (value.change !== 'record' && value.change !== 'delete') || typeof value.occurredAt !== 'number' ||
      typeof value.restricted !== 'boolean') return undefined;
  return {
    type: 'change',
    eventId: value.eventId,
    collectionId: value.collectionId,
    recordId: value.recordId,
    revision: value.revision,
    change: value.change,
    occurredAt: value.occurredAt,
    restricted: value.restricted,
  };
}

export class UnsV2ClientCore {
  private readonly transport: CloudTransport;

  constructor(resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}) {
    this.transport = new CloudTransport(resolveClient, config);
  }

  async call<Name extends UnsV2OperationName>(name: Name, request: UnsV2Request<Name>, options: RequestOptions = {}): Promise<UnsV2Response<Name>> {
    options.signal?.throwIfAborted();
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(UNS_V2_OPERATIONS, name)) {
      throw new TypeError('Tier0 SDK: unknown UNS v2 operation.');
    }
    const operation = UNS_V2_OPERATIONS[name];
    const mutation = operation.mutation;
    const path = resourcePath(operation, request);
    const body = encodeUnsV2JSON(request, operation.request);
    if (new TextEncoder().encode(body).byteLength > UNS_V2_MAX_REQUEST_BYTES) {
      throw new TypeError('Tier0 SDK: UNS v2 request body exceeds the 16777216-byte contract limit.');
    }
    let response: Awaited<ReturnType<CloudTransport['postText']>>;
    try {
      response = await this.transport.postText(path, body, options);
    } catch (error) {
      if (!(error instanceof CloudTransportError)) throw error;
      const message = error.kind === 'TRANSPORT_TIMEOUT'
        ? 'UNS v2 HTTP transport deadline exceeded.'
        : error.kind === 'PROTOCOL_ERROR' ? 'Invalid UNS v2 HTTP response.'
          : error.kind === 'TRANSPORT_ABORTED' ? 'UNS v2 request aborted.' : 'UNS v2 transport failed.';
      const resendable = error.kind === 'TRANSPORT_TIMEOUT' || error.kind === 'TRANSPORT_ERROR';
      throw localError(message, name, mutation, `UNS_V2_${error.kind}`, error.status, resendable);
    }

    // An ingress answers 502/503/504 without the UNS envelope during rollouts and restarts.
    const unavailable = response.status === 502 || response.status === 503 || response.status === 504;
    // `enveloped`: the body looks like a UNS envelope, so UNS may have answered it.
    const invalid = (message: string, enveloped: boolean) => localError(message, name, mutation, 'UNS_V2_PROTOCOL_ERROR', response.status, unavailable, {
      notStarted: !enveloped && rejectedBeforeUns(response.status),
      afterMs: unavailable ? retryAfterMs(response.retryAfter) : undefined,
    });
    let value: unknown;
    try {
      value = decodeUnsV2JSON(response.text, response.status === 200 ? operation.response : 'UnsV2ErrorResponse');
    } catch {
      throw invalid('Invalid UNS v2 response.', false);
    }

    if (response.status !== 200) {
      const info = errorInfo(value, response.status, name);
      if (!info || !record(value) || value.code !== response.status) {
        throw invalid('Invalid UNS v2 error response.', record(value) && typeof value.code === 'number');
      }
      // A read never has an unknown outcome; hold UNS to the rule it states for itself.
      if (!mutation && info.execution === 'unknown') info.execution = 'rolledBack';
      const message = typeof value.msg === 'string' ? value.msg : info.code;
      throw info.execution === 'unknown' ? new UnsV2OutcomeUnknownError(message, info) : new UnsV2Error(message, info);
    }

    if (!record(value) || value.code !== 200 || typeof value.msg !== 'string' ||
        typeof value.requestId !== 'string' || !Object.prototype.hasOwnProperty.call(value, 'data')) {
      throw localError('Invalid UNS v2 success envelope.', name, mutation, 'UNS_V2_PROTOCOL_ERROR', response.status, false);
    }
    return value as UnsV2Response<Name>;
  }

  /**
   * Opens one `records:subscribe` event stream and yields its events until
   * the server ends it or `signal` aborts (the generator then returns). It
   * neither reconnects nor watches heartbeats; `data.subscribe` does. A
   * refused or broken connection throws UnsV2Error (operation
   * `recordSubscribe`, a read: `retry.safe` says whether to reconnect).
   */
  async *subscribeRecords(request: UnsV2RecordSubscribeRequest, options: RequestOptions & { lastEventId?: string } = {}): AsyncGenerator<UnsV2SubscriptionEvent> {
    const name = 'recordSubscribe';
    const { collectionIds, recordIds } = request;
    if (collectionIds !== undefined && (!Array.isArray(collectionIds) || collectionIds.length < 1 || collectionIds.length > UNS_V2_SUBSCRIBE_MAX_COLLECTIONS)) {
      throw new TypeError(`Tier0 SDK: records:subscribe lists 1–${UNS_V2_SUBSCRIBE_MAX_COLLECTIONS} collections, or none for all.`);
    }
    if (recordIds !== undefined && (recordIds.length < 1 || recordIds.length > UNS_V2_SUBSCRIBE_MAX_RECORD_IDS || collectionIds?.length !== 1)) {
      throw new TypeError(`Tier0 SDK: records:subscribe takes 1–${UNS_V2_SUBSCRIBE_MAX_RECORD_IDS} recordIds of exactly one collection.`);
    }
    if (options.lastEventId !== undefined) assertEventId(options.lastEventId);
    // Repeated query parameters, as the contract specifies.
    const query = new URLSearchParams();
    for (const id of collectionIds ?? []) query.append('collectionIds', id);
    for (const id of recordIds ?? []) query.append('recordIds', id);
    const path = UNS_V2_STREAM_OPERATIONS.recordSubscribe.path + (query.size ? `?${query}` : '');
    let opened: Awaited<ReturnType<CloudTransport['getEventStream']>>;
    try {
      opened = await this.transport.getEventStream(path, options);
    } catch (error) {
      if (!(error instanceof CloudTransportError)) throw error;
      if (error.kind === 'TRANSPORT_ABORTED') return;
      const resendable = error.kind === 'TRANSPORT_TIMEOUT' || error.kind === 'TRANSPORT_ERROR';
      throw localError('UNS v2 event stream could not be opened.', name, false, `UNS_V2_${error.kind}`, error.status, resendable);
    }
    if ('text' in opened) {
      const unavailable = opened.status === 502 || opened.status === 503 || opened.status === 504;
      const invalid = (enveloped: boolean) => localError('Invalid UNS v2 event stream response.', name, false, 'UNS_V2_PROTOCOL_ERROR', opened.status, unavailable, {
        notStarted: !enveloped && rejectedBeforeUns(opened.status),
      });
      let value: unknown;
      try {
        value = decodeUnsV2JSON(opened.text, 'UnsV2ErrorResponse');
      } catch {
        throw invalid(false);
      }
      const info = opened.status === 200 ? undefined : errorInfo(value, opened.status, name);
      if (!info || !record(value) || value.code !== opened.status) throw invalid(record(value) && typeof value.code === 'number');
      // A subscription is a read: never an unknown outcome.
      if (info.execution === 'unknown') info.execution = 'rolledBack';
      throw new UnsV2Error(typeof value.msg === 'string' ? value.msg : info.code, info);
    }
    try {
      for await (const event of parseServerSentEvents(opened.stream)) {
        // A keep-alive comment counts as a heartbeat too.
        if ('comment' in event) {
          yield { type: 'heartbeat' };
        } else if (event.event === 'heartbeat') {
          yield event.id === undefined ? { type: 'heartbeat' } : { type: 'heartbeat', eventId: event.id };
        } else if (event.event === 'reset') {
          let body: unknown;
          try { body = JSON.parse(event.data); } catch { body = undefined; }
          if (!record(body) || typeof body.reason !== 'string') {
            throw localError('Invalid UNS v2 reset event.', name, false, 'UNS_V2_PROTOCOL_ERROR', 200, true);
          }
          yield typeof body.message === 'string'
            ? { type: 'reset', reason: body.reason, message: body.message }
            : { type: 'reset', reason: body.reason };
        } else if (event.event === 'change') {
          let parsed: UnsV2RecordChangeEvent | undefined;
          try { parsed = changeEvent(JSON.parse(event.data)); } catch { parsed = undefined; }
          if (!parsed) throw localError('Invalid UNS v2 change event.', name, false, 'UNS_V2_PROTOCOL_ERROR', 200, true);
          yield parsed;
        }
      }
    } catch (error) {
      if (options.signal?.aborted) return;
      if (error instanceof UnsV2Error) throw error;
      if (error instanceof ServerSentEventsError) throw localError(error.message, name, false, 'UNS_V2_PROTOCOL_ERROR', 200, true);
      throw localError('UNS v2 event stream broke.', name, false, 'UNS_V2_TRANSPORT_ERROR', 200, true);
    } finally {
      opened.close();
    }
  }
}

export type UnsV2Client = UnsV2ClientCore & UnsV2Operations;

export function createUnsV2Client(resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}): UnsV2Client {
  const core = new UnsV2ClientCore(resolveClient, config);
  const methods = Object.fromEntries(Object.keys(UNS_V2_OPERATIONS).map(name => [name, (request: unknown, options?: RequestOptions) =>
    core.call(name as UnsV2OperationName, request as UnsV2Request<UnsV2OperationName>, options)]));
  return Object.assign(core, methods) as unknown as UnsV2Client;
}

/** Uses configureClient()/TIER0_API_HOST/TIER0_API_KEY and does not imply v2 readiness. */
export const unsV2 = createUnsV2Client();
