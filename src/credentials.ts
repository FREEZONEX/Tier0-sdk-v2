/**
 * App credential token (design 21.7): a bare JWT in a tmpfs file that the guest
 * agent replaces atomically. `TIER0_CREDENTIALS_FILE` names it.
 *
 * `getApiKey()` is synchronous, so the file is read with synchronous IO and
 * cached by `(ino, mtime_ns, size)`; a change of any of them rereads it.
 * `node:fs` comes from `process.getBuiltinModule`, so browser bundles of the
 * HTTP client never see a Node import.
 *
 * The claims are read for identity only (`ws`, `app`). Only Backend and the
 * EMQX hook verify the signature.
 */
import { getEnvVar } from './runtime-env.js';

export interface AppCredentialClaims {
  ws: string;
  app: string;
  runtime?: 'deployed' | 'preview';
  release?: string;
  session?: string;
  exp?: number;
}

interface CachedToken {
  ino: bigint;
  mtimeNs: bigint;
  size: bigint;
  token: string;
}

const cache = new Map<string, CachedToken>();

function nodeFs(): typeof import('node:fs') | undefined {
  try {
    return typeof process !== 'undefined' ? process.getBuiltinModule?.('node:fs') : undefined;
  } catch {
    return undefined;
  }
}

/** Path of the token file; undefined outside an aenv-next VM. */
export function credentialsFile(): string | undefined {
  return getEnvVar('TIER0_CREDENTIALS_FILE')?.trim() || undefined;
}

/** The token in `path`, reread only when the file changed. Undefined when it cannot be read. */
export function readCredentialToken(path: string): string | undefined {
  const fs = nodeFs();
  if (!fs) return undefined;
  try {
    const stat = fs.statSync(path, { bigint: true });
    const cached = cache.get(path);
    if (cached && cached.ino === stat.ino && cached.mtimeNs === stat.mtimeNs && cached.size === stat.size) return cached.token;
    const token = fs.readFileSync(path, 'utf8').trim();
    if (!token) return undefined;
    cache.set(path, { ino: stat.ino, mtimeNs: stat.mtimeNs, size: stat.size, token });
    return token;
  } catch {
    cache.delete(path);
    return undefined;
  }
}

/** Forgets the cached token, so the next read goes to the file whatever its stat says. */
export function dropCachedCredential(path: string): void {
  cache.delete(path);
}

/** Decodes a JWT payload without verifying it; undefined when it is not one. */
export function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1];
  if (!payload || token.split('.').length !== 3) return undefined;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Identity of an App credential token; undefined for anything else, such as an API key. */
export function appCredentialClaims(token: string): AppCredentialClaims | undefined {
  const claims = decodeJwtClaims(token);
  if (claims?.typ !== 'app-credential' || typeof claims.ws !== 'string' || typeof claims.app !== 'string') return undefined;
  return claims as unknown as AppCredentialClaims;
}

/** Claims of the current token file, if there is one. */
export function currentAppCredential(): AppCredentialClaims | undefined {
  const path = credentialsFile();
  const token = path ? readCredentialToken(path) : undefined;
  return token ? appCredentialClaims(token) : undefined;
}
