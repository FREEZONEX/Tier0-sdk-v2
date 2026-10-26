import {
  CloudTransport,
  CloudTransportError,
  UNS_V2_MAX_REQUEST_BYTES,
  type CloudTransportConfig,
} from '../cloud-transport.js';
import { getClient, type HttpClient, type RequestOptions } from '../openapi/client.js';
import { decodeUnsV2JSON, encodeUnsV2JSON } from './codec.js';
import {
  UNS_V2_OPERATIONS,
  UNS_V2_OPERATION_SETS,
  type ErrorRetry,
  type Fault,
  type UnsV2Audience,
  type UnsV2CatalogOperationName,
  type UnsV2OperationName,
  type UnsV2Operations,
  type UnsV2Request,
  type UnsV2Response,
  type UnsV2Surface,
} from './generated.js';

type RecordValue = Record<string, unknown>;

/** @deprecated Compatibility shape for error responses from older servers. */
export interface RetryAdvice {
  recommendedAction: string;
  canRetrySameRequest: boolean;
  keepIdempotencyKey: boolean;
}

/** Manifest-backed discovery. It neither grants authority nor redirects compatibility calls. */
export function listUnsV2Operations(surface: UnsV2Surface = 'recommended', audience?: UnsV2Audience) {
  return UNS_V2_OPERATION_SETS[surface]
    .filter(name => audience === undefined || UNS_V2_OPERATIONS[name].audience === audience)
    .map(name => ({ name, ...UNS_V2_OPERATIONS[name] }));
}

/** JSON HTTP methods only. SSE subscriptions require their own streaming transport. */
export function listUnsV2Methods(surface: UnsV2Surface = 'recommended', audience?: UnsV2Audience): UnsV2OperationName[] {
  return listUnsV2Operations(surface, audience)
    .filter(operation => operation.method === 'POST')
    .map(operation => operation.name as UnsV2OperationName);
}

export interface UnsV2ErrorInfo {
  status?: number;
  operation: UnsV2OperationName;
  code: string;
  requestId?: string;
  retryable: boolean;
  execution?: Fault['execution'];
  retry?: ErrorRetry;
  retryAdvice?: RetryAdvice;
  rolledBack?: boolean;
  opId?: string;
  path?: string;
  details?: RecordValue[];
  repair?: string;
  reason?: string;
  queryId?: string;
  /** The error envelope's `data`, verbatim; stable access codes such as `data.reason` live here. */
  data?: unknown;
}

/** Server advice is exposed verbatim. The SDK never acts on it or retries a request. */
export class UnsV2Error extends Error implements UnsV2ErrorInfo {
  readonly status?: number;
  readonly operation: UnsV2OperationName;
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly execution?: Fault['execution'];
  readonly retry?: ErrorRetry;
  readonly retryAdvice?: RetryAdvice;
  readonly rolledBack?: boolean;
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
    this.retryable = info.retryable;
  }
}

/** A mutating request may have reached the service. Reconcile before any deliberate replay. */
export class UnsV2OutcomeUnknownError extends UnsV2Error {
  readonly outcomeUnknown = true;
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

function errorInfo(value: unknown, status: number, operation: UnsV2OperationName): UnsV2ErrorInfo | undefined {
  if (!record(value) || !record(value.error) || typeof value.error.code !== 'string' ||
      !Array.isArray(value.error.details)) return undefined;
  const fault = value.error;
  let retryFields: Pick<UnsV2ErrorInfo, 'retryable' | 'retryAdvice' | 'execution' | 'retry' | 'rolledBack'>;
  if ('execution' in fault || 'retry' in fault) {
    if (!['notStarted', 'rolledBack', 'committed', 'unknown'].includes(String(fault.execution)) ||
        !record(fault.retry) || typeof fault.retry.safe !== 'boolean') return undefined;
    retryFields = { execution: fault.execution as Fault['execution'], retry: fault.retry as ErrorRetry,
      retryable: fault.retry.safe, rolledBack: fault.execution === 'rolledBack' };
  } else {
    const advice = fault.retryAdvice;
    if (typeof fault.retryable !== 'boolean' || !record(advice) ||
        typeof advice.recommendedAction !== 'string' || typeof advice.canRetrySameRequest !== 'boolean' ||
        typeof advice.keepIdempotencyKey !== 'boolean') return undefined;
    retryFields = { retryable: fault.retryable, retryAdvice: advice as unknown as RetryAdvice,
      rolledBack: typeof fault.rolledBack === 'boolean' ? fault.rolledBack : undefined };
  }
  return {
    status,
    operation,
    code: value.error.code,
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    ...retryFields,
    opId: typeof value.error.opId === 'string' ? value.error.opId : undefined,
    path: typeof value.error.path === 'string' ? value.error.path : undefined,
    details: value.error.details.every(record) ? value.error.details : undefined,
    repair: typeof value.error.repair === 'string' ? value.error.repair : undefined,
    reason: typeof value.error.reason === 'string' ? value.error.reason : undefined,
    queryId: typeof value.error.queryId === 'string' ? value.error.queryId : undefined,
    data: value.data ?? undefined,
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
    const operation = UNS_V2_OPERATIONS[name as UnsV2CatalogOperationName];
    if (operation.method !== 'POST') {
      throw new TypeError('Tier0 SDK: SSE subscriptions cannot use the JSON POST client; use a streaming transport.');
    }
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
      const info: UnsV2ErrorInfo = {
        status: error.status,
        operation: name,
        code: `UNS_V2_${error.kind}`,
        retryable: false,
      };
      const message = error.kind === 'TRANSPORT_TIMEOUT'
        ? 'UNS v2 HTTP transport deadline exceeded.'
        : error.kind === 'PROTOCOL_ERROR' ? 'Invalid UNS v2 HTTP response.' : 'UNS v2 transport failed.';
      if (mutation) throw new UnsV2OutcomeUnknownError(message, info);
      throw new UnsV2Error(message, info);
    }

    let value: unknown;
    try {
      value = decodeUnsV2JSON(response.text, response.status === 200 ? operation.response : 'UnsV2ErrorResponse');
    } catch {
      const info: UnsV2ErrorInfo = {
        status: response.status,
        operation: name,
        code: 'UNS_V2_PROTOCOL_ERROR',
        retryable: false,
      };
      if (mutation) throw new UnsV2OutcomeUnknownError('Invalid UNS v2 response.', info);
      throw new UnsV2Error('Invalid UNS v2 response.', info);
    }

    if (response.status !== 200) {
      const info = errorInfo(value, response.status, name);
      if (!info || !record(value) || value.code !== response.status || (!mutation && info.execution === 'unknown')) {
        const invalid: UnsV2ErrorInfo = {
          status: response.status,
          operation: name,
          code: 'UNS_V2_PROTOCOL_ERROR',
          retryable: false,
        };
        if (mutation) throw new UnsV2OutcomeUnknownError('Invalid UNS v2 error response.', invalid);
        throw new UnsV2Error('Invalid UNS v2 error response.', invalid);
      }
      const message = record(value) && typeof value.msg === 'string' ? value.msg : info.code;
      // A multi-chunk write can have a known committed prefix and an unknown
      // later chunk. Its execution stays committed; accumulated data flags the ambiguity.
      if (mutation && (info.execution === 'unknown' || info.code === 'OUTCOME_UNKNOWN' ||
          (record(info.data) && info.data.outcomeUnknown === true))) throw new UnsV2OutcomeUnknownError(message, info);
      throw new UnsV2Error(message, info);
    }

    if (!record(value) || value.code !== 200 || typeof value.msg !== 'string' ||
        typeof value.requestId !== 'string' || !Object.prototype.hasOwnProperty.call(value, 'data')) {
      const info: UnsV2ErrorInfo = {
        status: response.status,
        operation: name,
        code: 'UNS_V2_PROTOCOL_ERROR',
        retryable: false,
      };
      if (mutation) throw new UnsV2OutcomeUnknownError('Invalid UNS v2 success envelope.', info);
      throw new UnsV2Error('Invalid UNS v2 success envelope.', info);
    }
    return value as UnsV2Response<Name>;
  }
}

export type UnsV2Client = UnsV2ClientCore & UnsV2Operations;

export function createUnsV2Client(resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}): UnsV2Client {
  const core = new UnsV2ClientCore(resolveClient, config);
  const methods = Object.fromEntries(listUnsV2Methods('all').map(name => [name, (request: unknown, options?: RequestOptions) =>
    core.call(name as UnsV2OperationName, request as UnsV2Request<UnsV2OperationName>, options)]));
  return Object.assign(core, methods) as unknown as UnsV2Client;
}

/** Uses configureClient()/TIER0_API_HOST/TIER0_API_KEY and does not imply v2 readiness. */
export const unsV2 = createUnsV2Client();
