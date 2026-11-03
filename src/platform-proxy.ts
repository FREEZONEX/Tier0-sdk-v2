/**
 * Platform proxy mode (design 21.28, revised 2026-11-03 "代理注入长期 App
 * Key"). Inside a Tier0 Preview or deployment the VM holds no platform
 * credential: no `TIER0_API_KEY`, no file. The node's `sbx-api-proxy` knows
 * the VM by its source address and injects the App's long-lived API key on
 * the way to Backend and EMQX; Preview and deployments use the same key. The
 * SDK therefore reads no credential and sends none; it marks each request with
 * `X-Tier0-SDK: 1`, which the proxy requires.
 *
 * The mode is on when `TIER0_RUNTIME` is `deployed` or `preview` and
 * `TIER0_API_KEY` is not set. Any other value of `TIER0_RUNTIME` without
 * `TIER0_API_KEY` is a configuration error and throws: guessing either way
 * would send requests the proxy refuses, or none at all. A client given its
 * own `apiKey` or `getApiKey` keeps using that and never looks.
 *
 * The identity comes from plain environment variables the platform sets. They
 * are identifiers, not secrets: a wrong value is refused, it grants nothing.
 */
import { getEnvVar } from './runtime-env.js';

/** Header the proxy requires on every request; it refuses requests without it. */
export const SDK_HEADER = 'X-Tier0-SDK';
/** Marks an answer the proxy produced itself: the request never reached the platform. */
export const PROXY_HEADER = 'X-Tier0-Proxy';
export const PROXY_NOT_FORWARDED = 'not-forwarded';

export interface PlatformIdentity {
  ws: string;
  app: string;
}

const env = (name: string) => getEnvVar(name)?.trim() || undefined;

/**
 * True inside a Tier0 Preview or deployment that has no API key of its own.
 * Throws when `TIER0_RUNTIME` is set to anything but `deployed` or `preview`
 * and `TIER0_API_KEY` is not set.
 */
export function platformProxyMode(): boolean {
  const runtime = env('TIER0_RUNTIME');
  if (runtime === undefined || env('TIER0_API_KEY') !== undefined) return false;
  if (runtime === 'deployed' || runtime === 'preview') return true;
  throw new TypeError(`Tier0 SDK v2: TIER0_RUNTIME must be "deployed" or "preview", not ${JSON.stringify(runtime.slice(0, 64))}.`);
}

/** The App this VM serves, from `TIER0_WORKSPACE_ID` and `TIER0_APP_ID`; undefined when incomplete or outside platform proxy mode. */
export function platformIdentity(): PlatformIdentity | undefined {
  if (!platformProxyMode()) return undefined;
  const ws = env('TIER0_WORKSPACE_ID');
  const app = env('TIER0_APP_ID');
  return ws && app ? { ws, app } : undefined;
}
