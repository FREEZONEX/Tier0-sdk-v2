// Server-only entry point. Browser HTTP clients remain independent of node:crypto.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_REQUEST_IDENTITY_CONTRACT as contract } from './app-identity-contract.generated.js';
import { getEnvVar } from './runtime-env.js';

export const APP_REQUEST_IDENTITY_HEADER = contract.header;

export class AppRequestIdentityError extends Error {
  constructor(public readonly code: 'APP_IDENTITY_INVALID' | 'APP_IDENTITY_CONFIGURATION_INVALID') {
    super(code);
    this.name = 'AppRequestIdentityError';
  }
}

export interface VerifiedCloudAppUser {
  readonly kind: 'gateway-user';
  readonly userID: string;
  readonly workspaceID: string;
  readonly appID: string;
  readonly roleKeys: readonly string[];
  readonly requestID: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly verificationKeyID: string;
}

export interface CloudAppIdentityAuthority {
  appID: string;
  workspaceID: string;
  /** Pinned server configuration, never a key or URL taken from the request. */
  publicKeys: unknown;
}

export interface CloudAppIdentityRequest {
  assertion: string | undefined;
  method: string;
  requestURI: string;
  /** Exact bytes received from the gateway, before JSON parsing or normalization. */
  body: Uint8Array;
}

const invalid = () => new AppRequestIdentityError('APP_IDENTITY_INVALID');
const invalidConfig = () => new AppRequestIdentityError('APP_IDENTITY_CONFIGURATION_INVALID');
const appPattern = new RegExp(contract.appIDPattern);
const kidPattern = new RegExp(contract.keyIDPattern);
const methodPattern = new RegExp(contract.methodPattern);
const maxID = BigInt('9223372036854775807');
const validID = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxID;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const validString = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maxBytes &&
  Buffer.from(value).toString('utf8') === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const decode = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw invalid();
  return bytes;
};

/** Verifies request provenance, not business authorization or delegated UNS permissions. */
export function createCloudAppRequestVerifier(authority: CloudAppIdentityAuthority) {
  if (!isObject(authority) || typeof authority.appID !== 'string' || !appPattern.test(authority.appID) || !validID(authority.workspaceID)) throw invalidConfig();
  const appID = authority.appID;
  const workspaceID = authority.workspaceID;
  const keys = new Map<string, KeyObject>();
  try {
    let raw = authority.publicKeys;
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw) > contract.maxTokenBytes * contract.maxKeys) throw invalidConfig();
      raw = JSON.parse(raw);
    }
    if (!isObject(raw) || !exactKeys(raw, ['keys']) || !Array.isArray(raw.keys) ||
        raw.keys.length === 0 || raw.keys.length > contract.maxKeys) throw invalidConfig();
    for (const key of raw.keys) {
      if (!isObject(key) || !exactKeys(key, contract.publicKeyFields) || key.kty !== 'OKP' ||
          key.crv !== 'Ed25519' || typeof key.kid !== 'string' || !kidPattern.test(key.kid) ||
          keys.has(key.kid) || typeof key.x !== 'string' || decode(key.x).length !== 32) throw invalidConfig();
      keys.set(key.kid, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.x }, format: 'jwk' }));
    }
  } catch { throw invalidConfig(); }

  return (request: CloudAppIdentityRequest): VerifiedCloudAppUser => {
    try {
      if (typeof request.assertion !== 'string' || Buffer.byteLength(request.assertion) > contract.maxTokenBytes ||
          !(request.body instanceof Uint8Array) || request.body.byteLength > contract.maxBodyBytes ||
          !methodPattern.test(request.method) || !validString(request.requestURI, contract.maxURIBytes) ||
          !request.requestURI.startsWith('/') || request.requestURI.startsWith('//')) throw invalid();
      const parts = request.assertion.split('.');
      if (parts.length !== 3) throw invalid();
      const header: unknown = JSON.parse(decode(parts[0]).toString('utf8'));
      if (!isObject(header) || !exactKeys(header, contract.requiredHeaderFields) ||
          header.alg !== contract.algorithm || header.typ !== contract.type ||
          typeof header.kid !== 'string' || !kidPattern.test(header.kid)) throw invalid();
      const key = keys.get(header.kid);
      const signature = decode(parts[2]);
      if (!key || signature.length !== 64 ||
          !verify(null, Buffer.from(parts[0] + '.' + parts[1], 'ascii'), key, signature)) throw invalid();
      const claims: unknown = JSON.parse(decode(parts[1]).toString('utf8'));
      if (!isObject(claims) || !exactKeys(claims, contract.requiredClaims) ||
          claims.ver !== contract.version || claims.iss !== contract.issuer || claims.aud !== contract.audience ||
          !validID(claims.sub) || claims.workspaceID !== workspaceID || claims.appID !== appID ||
          claims.method !== request.method || claims.requestURI !== request.requestURI ||
          typeof claims.bodySHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(claims.bodySHA256) ||
          claims.bodySHA256 !== createHash('sha256').update(request.body).digest('hex') ||
          typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat <= 0 ||
          typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= claims.iat ||
          claims.exp - claims.iat > contract.maxTTLSeconds ||
          typeof claims.jti !== 'string' || !/^[a-f0-9]{32}$/.test(claims.jti) ||
          !Array.isArray(claims.roles) || claims.roles.length > contract.maxRoles ||
          claims.roles.some((role) => !validString(role, contract.maxRoleBytes) || role.trim() !== role) ||
          new Set(claims.roles).size !== claims.roles.length) throw invalid();
      const now = Math.floor(Date.now() / 1000);
      if (claims.iat > now + contract.clockSkewSeconds || now >= claims.exp + contract.clockSkewSeconds) throw invalid();
      return Object.freeze({
        kind: 'gateway-user' as const, userID: claims.sub, workspaceID, appID,
        roleKeys: Object.freeze([...claims.roles] as string[]), requestID: claims.jti,
        issuedAt: claims.iat, expiresAt: claims.exp, verificationKeyID: header.kid,
      });
    } catch { throw invalid(); }
  };
}

export const VISITOR_TOKEN_HEADER = 'X-Tier0-Visitor';

const VISITOR_ISSUER = 'tier0-frontdoor';
/** Design 21.0: at most 60 s valid, verified with 60 s of clock tolerance. */
const VISITOR_MAX_TTL_SECONDS = 60;
const VISITOR_CLOCK_SKEW_SECONDS = 60;
const VISITOR_MAX_BYTES = 8192;
const VISITOR_KID = /^[A-Za-z0-9_.-]{1,128}$/;

export type VisitorTokenErrorCode = 'VISITOR_TOKEN_INVALID' | 'VISITOR_TOKEN_CONFIGURATION_INVALID';

export class VisitorTokenError extends Error {
  constructor(public readonly code: VisitorTokenErrorCode) {
    super(code);
    this.name = 'VisitorTokenError';
  }
}

/** The verified claims of a visitor token (access design 4.4). */
export interface VerifiedVisitor {
  readonly subType: 'employee' | 'machine';
  readonly subject: string;
  readonly grant: string;
  readonly workspaceID: string;
  readonly appID: string;
  readonly runtime: 'deployed' | 'preview';
  /** Roles of this visitor in the App; in Preview, the selected "view as" roles. */
  readonly appRoles: readonly string[];
  readonly activeRole?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly tokenID: string;
  readonly verificationKeyID: string;
}

export interface VisitorKeySource {
  /** Current verification keys by `kid`. Called on every verification. */
  keys(): ReadonlyMap<string, KeyObject>;
}

/** Parses a JWKS document into Ed25519 keys by `kid`; a malformed key is skipped, so one bad entry cannot stop a rotation. */
export function parseVisitorJwks(document: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  if (!isObject(document) || !Array.isArray(document.keys)) throw new VisitorTokenError('VISITOR_TOKEN_CONFIGURATION_INVALID');
  for (const key of document.keys) {
    if (!isObject(key) || key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.kid !== 'string' || !VISITOR_KID.test(key.kid) || typeof key.x !== 'string') continue;
    try {
      keys.set(key.kid, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.x }, format: 'jwk' }));
    } catch {
      // Skip it, see above.
    }
  }
  return keys;
}

/**
 * Keys from `<dir>/tier0-frontdoor.json` (design 21.7). The guest agent replaces
 * the file whole on rotation, so it is reread when `(ino, mtime_ns, size)`
 * changes; every verification sees the latest set. While a replacement cannot
 * be parsed, the last good set stays in use.
 */
export function frontdoorKeysFromDir(dir: string | undefined = getEnvVar('TIER0_JWKS_DIR')): VisitorKeySource {
  if (!dir?.trim()) throw new VisitorTokenError('VISITOR_TOKEN_CONFIGURATION_INVALID');
  const path = join(dir.trim(), 'tier0-frontdoor.json');
  let stamp: string | undefined;
  let current = new Map<string, KeyObject>();
  return {
    keys() {
      try {
        const stat = statSync(path, { bigint: true });
        const next = `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
        if (next !== stamp) {
          current = parseVisitorJwks(JSON.parse(readFileSync(path, 'utf8')));
          // `dev-` kids belong to the development signer; the platform never trusts one.
          for (const kid of current.keys()) if (kid.startsWith('dev-')) current.delete(kid);
          stamp = next;
        }
      } catch {
        // Keep the last good set; an empty one refuses every token.
      }
      return current;
    },
  };
}

/** Without the directory, keys are fetched from the front door at this interval (design 21.0: verifiers refresh within 60 s). */
export const FRONTDOOR_JWKS_REFRESH_MS = 60_000;
/** An unknown `kid` triggers an early refresh at most this often, so a rotation is picked up without waiting a full interval. */
export const FRONTDOOR_JWKS_MISS_REFRESH_MS = 10_000;
const FRONTDOOR_JWKS_TIMEOUT_MS = 10_000;
const FRONTDOOR_JWKS_MAX_BYTES = 64 * 1024;

export interface FrontdoorKeysFromUrlOptions {
  refreshMs?: number;
  missRefreshMs?: number;
  /** For tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** A key source fed by background fetches. `ready()` resolves after the first fetch settles, successful or not. */
export interface RefreshingVisitorKeySource extends VisitorKeySource {
  ready(): Promise<void>;
  /** Stops the refresh timer. */
  close(): void;
}

/** A key set that reports lookups of an unknown `kid` (they start an early refresh). */
class MissAwareKeys extends Map<string, KeyObject> {
  constructor(entries: Iterable<readonly [string, KeyObject]>, private readonly onMiss: () => void) {
    super(entries);
  }

  override get(kid: string): KeyObject | undefined {
    const key = super.get(kid);
    if (!key) this.onMiss();
    return key;
  }
}

/**
 * Keys fetched from the front door's public JWKS (`https://<app>.<apps domain>/__tier0/jwks.json`, given to published
 * Apps as `TIER0_JWKS_URL`). Published Apps run without the guest agent that writes `TIER0_JWKS_DIR`. The set is
 * refreshed every `refreshMs`, and early (at most every `missRefreshMs`) when a token names an unknown `kid`; the
 * verification that saw the unknown kid still fails, the next one sees the new set. A failed or malformed fetch
 * keeps the last good set. Until the first fetch lands the set is empty and every token is refused.
 */
export function frontdoorKeysFromUrl(url: string | undefined = getEnvVar('TIER0_JWKS_URL'), options: FrontdoorKeysFromUrlOptions = {}): RefreshingVisitorKeySource {
  const target = url?.trim();
  if (!target || !/^https?:\/\//i.test(target)) throw new VisitorTokenError('VISITOR_TOKEN_CONFIGURATION_INVALID');
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new VisitorTokenError('VISITOR_TOKEN_CONFIGURATION_INVALID');
  const refreshMs = options.refreshMs ?? FRONTDOOR_JWKS_REFRESH_MS;
  const missRefreshMs = options.missRefreshMs ?? FRONTDOOR_JWKS_MISS_REFRESH_MS;
  let inflight: Promise<void> | undefined;
  let lastStart = 0;
  const onMiss = () => { if (Date.now() - lastStart >= missRefreshMs) void refresh(); };
  let current: Map<string, KeyObject> = new MissAwareKeys([], onMiss);

  const refresh = (): Promise<void> => {
    if (inflight) return inflight;
    lastStart = Date.now();
    inflight = (async () => {
      try {
        const response = await doFetch(target, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FRONTDOOR_JWKS_TIMEOUT_MS) });
        if (!response.ok) return;
        const text = await response.text();
        if (Buffer.byteLength(text) > FRONTDOOR_JWKS_MAX_BYTES) return;
        const parsed = parseVisitorJwks(JSON.parse(text));
        current = new MissAwareKeys([...parsed].filter(([kid]) => !kid.startsWith('dev-')), onMiss);
      } catch {
        // Keep the last good set.
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  };

  const first = refresh();
  const timer = setInterval(() => { void refresh(); }, refreshMs);
  timer.unref?.();
  return {
    keys: () => current,
    ready: () => first,
    close: () => clearInterval(timer),
  };
}

/**
 * The default key source: `TIER0_JWKS_DIR` when it exists (sessions and the old runtime, where an agent writes the
 * file), otherwise the front door's public JWKS at `TIER0_JWKS_URL` (published Apps on PandaStack).
 */
export function frontdoorKeys(): VisitorKeySource {
  const dir = getEnvVar('TIER0_JWKS_DIR')?.trim();
  if (dir && existsSync(dir)) return frontdoorKeysFromDir(dir);
  if (getEnvVar('TIER0_JWKS_URL')?.trim()) return frontdoorKeysFromUrl();
  if (dir) return frontdoorKeysFromDir(dir);
  throw new VisitorTokenError('VISITOR_TOKEN_CONFIGURATION_INVALID');
}

export interface VisitorVerifierConfig {
  /** Expected `aud` is `app:<appID>`. Defaults to `TIER0_APP_ID`. */
  appID?: string;
  /** Defaults to `frontdoorKeys()`: the `TIER0_JWKS_DIR` file, or the front door's public JWKS at `TIER0_JWKS_URL`. */
  keys?: VisitorKeySource;
}

/**
 * Visitor token verification, contract v2 (access design 4.4). Checks signature,
 * `kid`, `iss`, `typ`, `aud` and the time window. Unlike
 * `createCloudAppRequestVerifier` it binds neither the request body nor the
 * release: the front door cannot know which release serves the request.
 */
export function createVisitorTokenVerifier(config: VisitorVerifierConfig = {}) {
  const source = config.keys ?? frontdoorKeys();
  const fixedAppID = config.appID;
  const fail = () => new VisitorTokenError('VISITOR_TOKEN_INVALID');

  return (token: string | null | undefined): VerifiedVisitor => {
    const appID = fixedAppID ?? getEnvVar('TIER0_APP_ID')?.trim();
    if (!appID) throw new VisitorTokenError('VISITOR_TOKEN_CONFIGURATION_INVALID');
    try {
      if (typeof token !== 'string' || Buffer.byteLength(token) > VISITOR_MAX_BYTES) throw fail();
      const parts = token.split('.');
      if (parts.length !== 3) throw fail();
      const header: unknown = JSON.parse(decode(parts[0]).toString('utf8'));
      if (!isObject(header) || header.alg !== 'EdDSA' || typeof header.kid !== 'string') throw fail();
      const key = source.keys().get(header.kid);
      const signature = decode(parts[2]);
      if (!key || signature.length !== 64 ||
          !verify(null, Buffer.from(parts[0] + '.' + parts[1], 'ascii'), key, signature)) throw fail();
      const claims: unknown = JSON.parse(decode(parts[1]).toString('utf8'));
      if (!isObject(claims) || claims.iss !== VISITOR_ISSUER || claims.typ !== 'visitor' || claims.aud !== `app:${appID}` ||
          (claims.sub_type !== 'employee' && claims.sub_type !== 'machine') ||
          !validString(claims.sub, 128) || (claims.sub_type === 'employee' && !validString(claims.grant, 128)) || !validID(claims.ws) ||
          (claims.runtime !== 'deployed' && claims.runtime !== 'preview') ||
          !Array.isArray(claims.app_roles) || claims.app_roles.some((role) => !validString(role, contract.maxRoleBytes)) ||
          (claims.active_role !== undefined && claims.active_role !== null && claims.active_role !== '' && !validString(claims.active_role, contract.maxRoleBytes)) ||
          typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) ||
          typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= claims.iat ||
          claims.exp - claims.iat > VISITOR_MAX_TTL_SECONDS || !validString(claims.jti, 128)) throw fail();
      const now = Math.floor(Date.now() / 1000);
      if (claims.iat > now + VISITOR_CLOCK_SKEW_SECONDS || now >= claims.exp + VISITOR_CLOCK_SKEW_SECONDS) throw fail();
      return Object.freeze({
        subType: claims.sub_type, subject: claims.sub, grant: typeof claims.grant === 'string' ? claims.grant : '',
        workspaceID: claims.ws, appID, runtime: claims.runtime,
        appRoles: Object.freeze([...new Set(claims.app_roles as string[])]),
        ...(typeof claims.active_role === 'string' && claims.active_role ? { activeRole: claims.active_role } : {}),
        issuedAt: claims.iat, expiresAt: claims.exp, tokenID: claims.jti, verificationKeyID: header.kid,
      });
    } catch (error) {
      if (error instanceof VisitorTokenError && error.code === 'VISITOR_TOKEN_CONFIGURATION_INVALID') throw error;
      throw fail();
    }
  };
}
