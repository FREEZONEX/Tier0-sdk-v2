/**
 * Runtime failures of a data call, missing credentials included, are a
 * `DataError`. The SDK's UNS client does the HTTP exchange; its `UnsV2Error`
 * (kept as `cause`) is translated here, and the data layer raises its own codes
 * (BATCH_LIMIT_EXCEEDED, WRITE_ERRORS, ...). `status` is the HTTP status the App
 * should answer its own caller with. Writes that fail validation throw
 * `ZodError`; programming or platform errors, such as invalid client options or
 * a malformed data subject from the gateway, throw `TypeError`.
 */
import { UnsV2OutcomeUnknownError, type UnsV2Error } from '../uns-v2/client.js';

/**
 * Stable `data.reason` codes UNS adds when it refuses App data access; the
 * top-level code stays FORBIDDEN / NOT_FOUND. Only whole-request errors carry
 * them, never per-item results of a batch or transaction.
 */
export const ACCESS_REASONS = {
  /** 403: the collection exists, but this App's grant does not cover it or the operation. */
  notGranted: 'COLLECTION_NOT_GRANTED',
  /** 403 or 404: the collection is gone (hard-deleted or archived). */
  notFound: 'COLLECTION_NOT_FOUND',
  /** 403: the grant covers the operation, the App key lacks `data.missingPermission`. */
  permissionMissing: 'APP_PERMISSION_MISSING',
} as const;

export class DataError extends Error {
  /** HTTP status the App should answer with (see `appStatus`). */
  readonly status: number;
  /** UNS error code, e.g. `DUPLICATE_KEY`, or a data-layer code. */
  readonly code: string;
  /** Stable `data.reason` code, e.g. `COLLECTION_NOT_FOUND` (see ACCESS_REASONS). */
  readonly reason?: string;
  /** HTTP status UNS answered with; 0 when no response arrived. */
  readonly upstreamStatus: number;
  readonly requestId?: string;
  readonly retryable: boolean;
  /** A write may have reached UNS: reconcile before replaying it with a new idempotency key. */
  readonly outcomeUnknown: boolean;
  /** The `data` object of the UNS error envelope, or data-layer details. */
  readonly details: Record<string, unknown>;

  constructor(init: {
    message: string;
    status: number;
    code: string;
    reason?: string;
    upstreamStatus?: number;
    requestId?: string;
    retryable?: boolean;
    outcomeUnknown?: boolean;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'DataError';
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason;
    this.upstreamStatus = init.upstreamStatus ?? 0;
    this.requestId = init.requestId;
    this.retryable = init.retryable ?? false;
    this.outcomeUnknown = init.outcomeUnknown ?? false;
    this.details = init.details ?? {};
  }
}

/**
 * Maps an upstream UNS status to the status the App answers its own caller
 * with. Credential failures are the platform's problem, not the user's
 * session, so a 401 from UNS becomes 502 instead of looking like a logout,
 * and a retryable 403 becomes 503 instead of looking like a denied action.
 */
export function appStatus(upstream: number, retryable = false): number {
  if (upstream === 401) return 502;
  // A retryable refusal is a platform state, not the caller's permission:
  // e.g. FORBIDDEN "hosted App is not ready" right after an import.
  if (upstream === 403 && retryable) return 503;
  if (upstream === 400 || upstream === 403 || upstream === 404 || upstream === 409 || upstream === 413 || upstream === 422 || upstream === 429) {
    return upstream;
  }
  if (upstream === 502 || upstream === 503 || upstream === 504) return 503;
  if (upstream >= 500) return 502;
  return upstream >= 400 ? 400 : 502;
}

const CODE_HINTS: Record<string, string> = {
  UPSERT_REQUIRES_UNIQUE_INDEX:
    'An upsert filter must contain `_id` or every field of a unique index that is already ready; a newly declared unique index may still be building.',
  DUPLICATE_KEY:
    'A unique index already holds this value. (From restore: an active record took the value meanwhile; nothing was restored.)',
  VERSION_CONFLICT: 'The record changed since it was read; reload it and retry with the new revision.',
  APP_GRANT_REVOKED:
    "A workspace admin revoked this App's access to the collection; it is not re-granted automatically. Ask the admin to restore the grant.",
  INDEX_QUOTA_EXCEEDED:
    'The workspace index quota (200, counting every index that physically exists) is exhausted. Remove unused indexes through the tier0 MCP.',
  COLLECTION_TOO_LARGE:
    'archive / restore handle at most 2000 records; stop using a large collection in code instead of archiving it.',
};

/** `APP_QUOTA_EXCEEDED` per `data.resource`; each per-App limit is 64. */
const QUOTA_HINTS: Record<string, string> = {
  collections: 'This App owns 64 active collections. Archive unused ones through the tier0 MCP.',
  indexes: "This App's collections hold 64 indexes. Drop unused indexes from the declarations, then apply that with schema:replace through the tier0 MCP.",
  archivedCollections:
    'This App keeps 64 archived collections. Restore one, or ask a workspace admin to clean up archived collections.',
};

/** SDK transport failures: no UNS answer to map, so the data layer names them. */
const TRANSPORT_FAILURES: Record<string, { code: string; status: number; retryable: boolean; message: string }> = {
  UNS_V2_TRANSPORT_TIMEOUT: { code: 'DATA_TIMEOUT', status: 503, retryable: true, message: 'UNS did not answer in time' },
  UNS_V2_TRANSPORT_ERROR: { code: 'DATA_UNREACHABLE', status: 503, retryable: true, message: 'Cannot reach the Tier0 data service' },
  UNS_V2_PROTOCOL_ERROR: { code: 'DATA_BAD_RESPONSE', status: 502, retryable: false, message: 'UNS answered with an invalid response' },
};

function codeHint(code: string, details: Record<string, unknown>): string | undefined {
  if (code === 'APP_QUOTA_EXCEEDED') {
    const resource = typeof details.resource === 'string' ? details.resource : '';
    return QUOTA_HINTS[resource] ?? 'This App reached a collection/index quota. Remove unused collections or indexes through the tier0 MCP.';
  }
  return CODE_HINTS[code];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Translates a failed UNS call of the SDK client. */
export function toDataError(error: UnsV2Error): DataError {
  const outcomeUnknown = error instanceof UnsV2OutcomeUnknownError;
  // An ingress or load balancer answers 502/503/504 without the UNS envelope during
  // rolling releases and pod restarts: retryable, like any unavailable upstream.
  // UNS v2 routes answer every other error with the envelope (401/403/429 included),
  // so other unenveloped responses stay DATA_BAD_RESPONSE.
  if (error.code === 'UNS_V2_PROTOCOL_ERROR' && (error.status === 502 || error.status === 503 || error.status === 504)) {
    return new DataError({
      message: `The Tier0 data gateway answered ${error.operation} with HTTP ${error.status}; retry shortly${outcomeUnknown ? ' (the write outcome is unknown)' : ''}.`,
      status: 503,
      code: `HTTP_${error.status}`,
      upstreamStatus: error.status,
      retryable: true,
      outcomeUnknown,
      cause: error,
    });
  }
  const transport = TRANSPORT_FAILURES[error.code];
  if (transport) {
    return new DataError({
      message: `${transport.message} (${error.operation})${outcomeUnknown ? '; the write outcome is unknown' : ''}.`,
      status: transport.status,
      code: transport.code,
      upstreamStatus: error.status,
      retryable: transport.retryable,
      outcomeUnknown,
      cause: error,
    });
  }

  const httpStatus = error.status ?? 0;
  const data = isObject(error.data) ? error.data : {};
  // Only `data.reason` is a code; `error.reason` repeats the message text.
  const reason = typeof data.reason === 'string' ? data.reason : undefined;
  // A canonical server decision overrides status-based legacy heuristics:
  // a 503 can describe a partial commit that must not be retried automatically.
  const retryable = error.retry?.safe ?? (error.retryable || httpStatus === 503 || httpStatus === 504);
  const code = error.code;
  const msg = error.message;
  const hint = codeHint(code, data);
  let message = `${msg} (${code})`;
  if (httpStatus === 403 && retryable) {
    message = `${msg} (${code}). The platform is still preparing this App; retry shortly.`;
  } else if (reason === ACCESS_REASONS.permissionMissing) {
    message =
      data.missingPermission === 'uns.delete'
        ? `Deleting records requires the App key to hold uns.delete, and this App's key does not (${code}). ` +
          'Model removal as a status change such as `archived`, or ask a workspace admin to grant uns.delete.'
        : `The App key lacks ${typeof data.missingPermission === 'string' ? data.missingPermission : 'a permission'} for this operation (${code}); ask a workspace admin.`;
  } else if (reason === ACCESS_REASONS.notGranted) {
    message = `${message} This App's grant does not cover the collection or operation; ask a workspace admin to restore the grant.`;
  } else if (reason === ACCESS_REASONS.notFound) {
    message = `${message} The collection was archived or deleted; the data layer ensures the declared collections again.`;
  } else if (httpStatus === 401) {
    message = `Tier0 rejected the App credential for ${error.operation} (${code}). The platform injects TIER0_API_KEY; do not replace it.`;
  } else if (hint) {
    message = `${message} ${hint}`;
  }

  return new DataError({
    message,
    status: appStatus(httpStatus, retryable),
    code,
    reason,
    upstreamStatus: httpStatus,
    requestId: error.requestId,
    retryable,
    outcomeUnknown,
    details: data,
    cause: error,
  });
}
