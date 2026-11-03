/**
 * Platform proxy mode (design 21.7, 21.28). Inside a Tier0 Preview or
 * deployment the VM holds no platform credential: no token file, no
 * `TIER0_API_KEY`. The node's `sbx-api-proxy` knows the VM by its source
 * address and attaches the App credential token on the way to Backend and
 * EMQX. The SDK therefore reads no credential and sends none; it marks each
 * request with `X-Tier0-SDK: 1`, which the proxy requires.
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

export type PlatformRuntime = 'deployed' | 'preview';

export interface PlatformIdentity {
  ws: string;
  app: string;
  runtime: PlatformRuntime;
  /** Deployments only. */
  release?: string;
  /** Previews only. */
  session?: string;
}

const env = (name: string) => getEnvVar(name)?.trim() || undefined;

/** The platform runtime, or undefined outside platform proxy mode. Throws on an invalid `TIER0_RUNTIME`. */
function proxyRuntime(): PlatformRuntime | undefined {
  const runtime = env('TIER0_RUNTIME');
  if (runtime === undefined || env('TIER0_API_KEY') !== undefined) return undefined;
  if (runtime === 'deployed' || runtime === 'preview') return runtime;
  throw new TypeError(`Tier0 SDK v2: TIER0_RUNTIME must be "deployed" or "preview", not ${JSON.stringify(runtime.slice(0, 64))}.`);
}

/**
 * True inside a Tier0 Preview or deployment that has no API key of its own.
 * Throws when `TIER0_RUNTIME` is set to anything but `deployed` or `preview`
 * and `TIER0_API_KEY` is not set.
 */
export function platformProxyMode(): boolean {
  return proxyRuntime() !== undefined;
}

/** The runtime the proxy attaches the App credential for; undefined outside platform proxy mode. */
export function appCredentialRuntime(): PlatformRuntime | undefined {
  return proxyRuntime();
}

/** The App this VM serves, from the platform's environment; undefined when incomplete. */
export function platformIdentity(): PlatformIdentity | undefined {
  const runtime = appCredentialRuntime();
  const ws = env('TIER0_WORKSPACE_ID');
  const app = env('TIER0_APP_ID');
  if (!runtime || !ws || !app) return undefined;
  if (runtime === 'preview') {
    const session = env('TIER0_SESSION');
    return session ? { ws, app, runtime, session } : undefined;
  }
  const release = env('TIER0_RELEASE');
  return release ? { ws, app, runtime, release } : undefined;
}
