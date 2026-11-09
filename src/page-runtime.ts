/**
 * The platform page runtime (design 21.3), served by the front door at
 * `/__tier0/runtime.js`, and the platform errors of design 21.1. Browser-safe.
 *
 * The runtime owns presence and the authorization prompt. It never wraps
 * `fetch`, so callers report what they see: an authorization failure goes to
 * `reportAuthError`, a sleeping App waits for `resumed`. Without the runtime
 * (local development, outside the platform) subscriptions are no-ops and
 * errors go straight to the caller.
 */

export type Tier0AppState = 'unknown' | 'running' | 'starting' | 'sleeping' | 'failed' | 'auth_required';
export type Tier0Event = 'state' | 'sleeping' | 'starting' | 'resumed' | 'auth-required';
export type Tier0AuthErrorCode = 'grant_expired' | 'signed_out' | 'need_role' | 'unavailable';

export interface Tier0PageRuntimeV1 {
  readonly version: string;
  readonly appId: string;
  readonly policy: 'visible' | 'on_demand' | 'always_on';
  getState(): Tier0AppState;
  getSleepAt(): number | null;
  on(event: Tier0Event, listener: (detail: any) => void): () => void;
  reportAuthError(code: Tier0AuthErrorCode): void;
  keepAwake(): void;
}

const RUNTIME_KEY = Symbol.for('tier0.page-runtime.v1');

export function getPageRuntime(): Tier0PageRuntimeV1 | undefined {
  return (globalThis as typeof globalThis & { [RUNTIME_KEY]?: Tier0PageRuntimeV1 })[RUNTIME_KEY];
}

/** Subscribes to a runtime event; a no-op without the runtime. Returns the unsubscribe function. */
export function onPageRuntime(event: Tier0Event, listener: (detail: any) => void): () => void {
  return getPageRuntime()?.on(event, listener) ?? (() => undefined);
}

/** No instance is serving the App, so background work should wait for `resumed`. */
export function isAppSleeping(): boolean {
  return getPageRuntime()?.getState() === 'sleeping';
}

const AUTH_ERROR_CODES: ReadonlySet<string> = new Set<Tier0AuthErrorCode>(['grant_expired', 'signed_out', 'need_role', 'unavailable']);

export function isAuthErrorCode(code: string | undefined): code is Tier0AuthErrorCode {
  return code !== undefined && AUTH_ERROR_CODES.has(code);
}

/** Tells the runtime about an authorization failure; true when `code` is one. */
export function reportAuthError(code: string | undefined): boolean {
  if (!isAuthErrorCode(code)) return false;
  getPageRuntime()?.reportAuthError(code);
  return true;
}

/** A platform answer in the design 21.1 format. */
export interface PlatformError {
  status: number;
  code: string;
  retryable: boolean;
  retryAfterMs?: number;
  /** App state, on `sbx_sleeping`, `sbx_starting` and `sbx_start_failed`. */
  state?: string;
}

/** The platform error code of a response. The gateway strips this header from App responses, so an App's own 503 never has it. */
export function platformErrorCode(response: Response): string | undefined {
  return response.headers.get('x-sbx-error') ?? undefined;
}

/**
 * The platform error of a response, or undefined for an App's own answer.
 * Reads a clone, so the caller can still read the body. An unknown code keeps
 * the body's `retryable` (design 21.1: handle by status and `retryable`).
 */
export async function readPlatformError(response: Response): Promise<PlatformError | undefined> {
  const code = platformErrorCode(response);
  if (!code) return undefined;
  let body: Record<string, unknown> = {};
  try {
    const value: unknown = await response.clone().json();
    if (value !== null && typeof value === 'object') body = value as Record<string, unknown>;
  } catch {
    // The header is enough to classify it.
  }
  const retryAfter = body.retry_after_ms;
  return {
    status: response.status,
    code,
    retryable: body.retryable === true,
    ...(typeof retryAfter === 'number' && retryAfter >= 0 ? { retryAfterMs: retryAfter } : {}),
    ...(typeof body.state === 'string' ? { state: body.state } : {}),
  };
}
