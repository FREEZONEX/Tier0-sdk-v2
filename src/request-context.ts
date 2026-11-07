/**
 * Reads the delegation of the request being served. The store itself lives in
 * `data/context.ts` (it needs `node:async_hooks`); this side only touches the
 * process-wide symbol, so the HTTP client stays importable from a browser.
 */
export const DELEGATION_HEADER = 'X-Tier0-Delegation';

export interface RequestContext {
  /** Legacy `X-Tier0-App-Data-Subject`, sent with an API key only. */
  dataSubject?: string;
  /** `X-Tier0-Delegation`, forwarded as received. */
  delegation?: string;
  signal?: AbortSignal;
}

export const REQUEST_CONTEXT_KEY = Symbol.for('tier0.sdk-v2.data.request-context');

type ContextStore = { getStore(): RequestContext | null | undefined };

export function currentDelegation(): string | undefined {
  return (globalThis as typeof globalThis & { [REQUEST_CONTEXT_KEY]?: ContextStore })[REQUEST_CONTEXT_KEY]?.getStore()?.delegation;
}

/** ASCII-only syntax makes string length equal byte length. Do not trim or decode. */
export function assertCompactToken(value: string, name: string): void {
  if (value.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`Tier0 SDK: ${name} must be a compact three-segment base64url token of at most 8192 ASCII bytes.`);
  }
}
