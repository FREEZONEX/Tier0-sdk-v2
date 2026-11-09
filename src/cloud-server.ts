// Server-only entry point: the App's view of the request it is serving.
import { getEnvVar } from './runtime-env.js';

const maxID = BigInt('9223372036854775807');
/** A positive decimal int64 without sign or leading zero. */
const validID = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxID;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Set by the front door on every request it forwards to the App, after stripping any `X-Tier0-*` the client sent. */
export const VISITOR_HEADER = 'X-Tier0-Visitor';

/** Limit of the JSON before encoding. */
const VISITOR_MAX_JSON_BYTES = 8192;
/** Unpadded base64url of `VISITOR_MAX_JSON_BYTES`. */
const VISITOR_MAX_HEADER_LENGTH = Math.ceil((VISITOR_MAX_JSON_BYTES * 4) / 3);
const VISITOR_MAX_STRING_BYTES = 128;
const VISITOR_FIELDS: ReadonlySet<string> = new Set(['ws', 'app', 'runtime', 'sub_type', 'sub', 'grant', 'app_roles', 'active_role']);

export type VisitorErrorCode = 'VISITOR_HEADER_INVALID' | 'VISITOR_CONFIGURATION_INVALID';

export class VisitorError extends Error {
  constructor(public readonly code: VisitorErrorCode) {
    super(code);
    this.name = 'VisitorError';
  }
}

/** The visitor of a request, from `X-Tier0-Visitor`. */
export interface Visitor {
  readonly subType: 'employee' | 'machine';
  /** Employee user ID, or the call token ID of a machine visitor. */
  readonly subject: string;
  /** Grant of an employee's access; empty for a machine visitor. */
  readonly grant: string;
  readonly workspaceID: string;
  readonly appID: string;
  readonly runtime: 'deployed' | 'preview';
  /** Roles of this visitor in the App; in Preview, the roles selected in "view as". */
  readonly appRoles: readonly string[];
  /** Only in Preview's "view as". */
  readonly activeRole?: string;
}

export interface ParseVisitorOptions {
  /** The App the header must name. Defaults to `TIER0_APP_ID`. */
  appID?: string;
}

/** A UTF-16 surrogate without its pair, as JSON escapes like "\ud800" can produce. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Raw key tokens of the top-level object, for spotting duplicates
 * (`JSON.parse` keeps the last silently). Values of the visitor are strings
 * and arrays of strings, so only depth 1 holds keys.
 */
function topLevelKeys(json: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < json.length; i += 1) {
    const char = json[i];
    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === '"') {
      const start = i;
      for (i += 1; i < json.length && json[i] !== '"'; i += 1) if (json[i] === '\\') i += 1;
      let next = i + 1;
      while (next < json.length && /\s/.test(json[next])) next += 1;
      if (depth === 1 && json[next] === ':') keys.push(json.slice(start, i + 1));
    }
  }
  return keys;
}

const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
const sized = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && !LONE_SURROGATE.test(value) && bytes(value) >= min && bytes(value) <= max;

/**
 * Parses `X-Tier0-Visitor`: the unpadded base64url (RFC 4648 §5) of a UTF-8
 * JSON object of at most 8192 bytes. The header is not signed; the front door
 * is the only way into the App and replaces whatever the client sent. Parsing
 * is strict: a byte order mark, a duplicate key, a lone UTF-16 surrogate
 * (e.g. `"\ud800"`), an unknown or missing field, a wrong type or length, a `ws` that
 * is not a positive decimal ID without sign or leading zero, an employee
 * without a grant or a machine visitor with one, or an `app` other than this
 * App's throws `VISITOR_HEADER_INVALID`. Without an App ID
 * (`TIER0_APP_ID` unset) it throws `VISITOR_CONFIGURATION_INVALID`.
 */
export function parseVisitorHeader(value: string | null | undefined, options: ParseVisitorOptions = {}): Visitor {
  const appID = options.appID ?? getEnvVar('TIER0_APP_ID')?.trim();
  if (!appID) throw new VisitorError('VISITOR_CONFIGURATION_INVALID');
  const fail = () => new VisitorError('VISITOR_HEADER_INVALID');
  if (typeof value !== 'string' || value.length === 0 || value.length > VISITOR_MAX_HEADER_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) throw fail();
  const raw = Buffer.from(value, 'base64url');
  // Only the canonical encoding: no padding, no stray trailing bits.
  if (raw.length > VISITOR_MAX_JSON_BYTES || raw.toString('base64url') !== value) throw fail();
  // A UTF-8 byte order mark is not part of the contract (TextDecoder would drop it silently).
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw fail();
  let claims: unknown;
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    claims = JSON.parse(json);
  } catch {
    throw fail();
  }
  if (!isObject(claims) || Object.keys(claims).some((key) => !VISITOR_FIELDS.has(key))) throw fail();
  // Every key at most once, each spelling decoded ("\u0077s" is "ws").
  const keys = topLevelKeys(json).map((token) => JSON.parse(token) as string);
  if (new Set(keys).size !== keys.length) throw fail();
  const { ws, app, runtime, sub_type: subType, sub, grant, app_roles: appRoles, active_role: activeRole } = claims;
  if (!validID(ws) || app !== appID ||
      (runtime !== 'deployed' && runtime !== 'preview') ||
      (subType !== 'employee' && subType !== 'machine') ||
      !sized(sub, 1, VISITOR_MAX_STRING_BYTES) ||
      // An employee's access always has a grant; a machine visitor has none.
      typeof grant !== 'string' || (subType === 'employee' ? !sized(grant, 1, VISITOR_MAX_STRING_BYTES) : grant !== '') ||
      !Array.isArray(appRoles) || appRoles.some((role) => !sized(role, 1, VISITOR_MAX_STRING_BYTES)) ||
      (activeRole !== undefined && !sized(activeRole, 1, VISITOR_MAX_STRING_BYTES))) throw fail();
  return Object.freeze({
    subType, subject: sub, grant, workspaceID: ws, appID, runtime,
    appRoles: Object.freeze([...new Set(appRoles as string[])]),
    ...(activeRole === undefined ? {} : { activeRole }),
  });
}
