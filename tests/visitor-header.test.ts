import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseVisitorHeader, VISITOR_HEADER, VisitorError } from '../src/cloud-server.js';

const APP = '0b9f4b1e-6d0a-4c6b-9f53-2f6d7a1c8e01';
/** The contract's test vector: these fields, in this order, without spaces. */
const VECTOR_JSON = `{"ws":"1001","app":"${APP}","runtime":"deployed","sub_type":"employee","sub":"42","grant":"g-1","app_roles":["manager"]}`;
const VECTOR = 'eyJ3cyI6IjEwMDEiLCJhcHAiOiIwYjlmNGIxZS02ZDBhLTRjNmItOWY1My0yZjZkN2ExYzhlMDEiLCJydW50aW1lIjoiZGVwbG95ZWQiLCJzdWJfdHlwZSI6ImVtcGxveWVlIiwic3ViIjoiNDIiLCJncmFudCI6ImctMSIsImFwcF9yb2xlcyI6WyJtYW5hZ2VyIl19';

const encode = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const claims = (patch: Record<string, unknown> = {}) => ({ ...JSON.parse(VECTOR_JSON), ...patch });
const parse = (value: string | null | undefined) => parseVisitorHeader(value, { appID: APP });
/** A valid header with one padding bit set: decodes to the same bytes, but is not the canonical encoding. */
function nonCanonical(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const value = ['4', '42', '423'].map((sub) => encode(claims({ sub }))).find((encoded) => encoded.length % 4 !== 0)!;
  const altered = value.slice(0, -1) + alphabet[alphabet.indexOf(value.at(-1)!) + 1];
  expect(Buffer.from(altered, 'base64url')).toEqual(Buffer.from(value, 'base64url'));
  return altered;
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(VisitorError);
    return (error as VisitorError).code;
  }
  throw new Error('accepted');
};

describe('X-Tier0-Visitor', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is the header the front door sets', () => {
    expect(VISITOR_HEADER).toBe('X-Tier0-Visitor');
  });

  it('parses the contract test vector', () => {
    expect(encode(VECTOR_JSON)).toBe(VECTOR);
    const visitor = parse(VECTOR);
    expect(visitor).toEqual({
      subType: 'employee', subject: '42', grant: 'g-1', workspaceID: '1001', appID: APP, runtime: 'deployed', appRoles: ['manager'],
    });
    expect(Object.isFrozen(visitor)).toBe(true);
    expect(Object.isFrozen(visitor.appRoles)).toBe(true);
  });

  it('checks the App against TIER0_APP_ID by default', () => {
    vi.stubEnv('TIER0_APP_ID', APP);
    expect(parseVisitorHeader(VECTOR).appID).toBe(APP);
    vi.stubEnv('TIER0_APP_ID', '11111111-2222-4333-8444-555555555555');
    expect(code(() => parseVisitorHeader(VECTOR))).toBe('VISITOR_HEADER_INVALID');
    vi.stubEnv('TIER0_APP_ID', '');
    expect(code(() => parseVisitorHeader(VECTOR))).toBe('VISITOR_CONFIGURATION_INVALID');
  });

  it('accepts employee Preview, an active role and no roles', () => {
    expect(parse(encode(claims({ app_roles: [] })))).toMatchObject({ subType: 'employee', appRoles: [] });
    expect(parse(encode(claims({ runtime: 'preview', app_roles: ['manager', 'viewer'], active_role: 'viewer' })))).toMatchObject({
      runtime: 'preview', appRoles: ['manager', 'viewer'], activeRole: 'viewer',
    });
    expect(parse(encode(claims({ app_roles: Array.from({ length: 200 }, (_, i) => `r${i}`) }))).appRoles).toHaveLength(200);
    expect(parse(encode(VECTOR_JSON.replace('"sub":"42"', '"sub":"\\ud83d\\ude00"'))).subject).toBe('\u{1F600}');
    expect(parse(encode(claims({ ws: '9223372036854775807' }))).workspaceID).toBe('9223372036854775807');
    expect(parse(encode(claims({ app_roles: ['manager', 'manager', 'viewer'] }))).appRoles).toEqual(['manager', 'viewer']);
    expect(parse(encode(claims({ sub: 'x'.repeat(128), grant: 'g'.repeat(128), app_roles: ['r'.repeat(128)] }))).subject).toHaveLength(128);
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['padded', `${VECTOR}==`],
    ['standard base64', Buffer.from(VECTOR_JSON).toString('base64').replace(/=+$/, '') + '+/'],
    ['not canonical', 'non-canonical'],
    ['not JSON', encode('ws=1001')],
    ['not UTF-8', Buffer.from([0x7b, 0xff, 0x7d]).toString('base64url')],
    ['a JSON array', encode([claims()])],
    ['JSON null', encode('null')],
    ['over 8192 bytes', encode({ ...claims(), sub: '1'.repeat(9000) })],
    ['a signed token', `${VECTOR}.${VECTOR}.sig`],
    ['led by a UTF-8 byte order mark', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(VECTOR_JSON)]).toString('base64url')],
    ['over 8192 bytes of roles', encode({ ...claims(), app_roles: Array.from({ length: 1000 }, (_, i) => `role-${i}`) })],
    ['carrying a duplicate key', encode(VECTOR_JSON.replace('"sub":"42"', '"sub":"42","sub":"43"'))],
    ['carrying a duplicate key in another spelling', encode(VECTOR_JSON.replace('"sub":"42"', '"sub":"42","\\u0073ub":"43"'))],
    ['carrying a lone surrogate in the subject', encode(VECTOR_JSON.replace('"sub":"42"', '"sub":"4\\ud8002"'))],
    ['carrying a lone surrogate in a role', encode(VECTOR_JSON.replace('["manager"]', '["\\udc00"]'))],
  ])('refuses a header that is %s', (_name, value) => {
    expect(code(() => parse(value === 'non-canonical' ? nonCanonical() : value))).toBe('VISITOR_HEADER_INVALID');
  });

  it.each([
    ['an unknown field', { iss: 'tier0-frontdoor' }],
    ['an expiry', { exp: 1 }],
    ['a workspace that is not a decimal ID', { ws: 1001 }],
    ['a workspace with a leading zero', { ws: '01001' }],
    ['a signed workspace', { ws: '+1001' }],
    ['a negative workspace', { ws: '-1001' }],
    ['a zero workspace', { ws: '0' }],
    ['an empty workspace', { ws: '' }],
    ['a fractional workspace', { ws: '1001.5' }],
    ['a workspace with spaces', { ws: ' 1001' }],
    ['a workspace beyond int64', { ws: '9223372036854775808' }],
    ['an employee without a grant', { grant: '' }],
    ['a retired machine visitor without a grant', { sub_type: 'machine', sub: 't0w_abc', grant: '', app_roles: [] }],
    ['a machine visitor with a grant', { sub_type: 'machine', sub: 't0w_abc', grant: 'g-1', app_roles: [] }],
    ['another App', { app: '11111111-2222-4333-8444-555555555555' }],
    ['an unknown runtime', { runtime: 'staging' }],
    ['an unknown visitor type', { sub_type: 'user' }],
    ['an empty subject', { sub: '' }],
    ['a subject over 128 bytes', { sub: 'é'.repeat(65) }],
    ['a numeric subject', { sub: 42 }],
    ['a grant over 128 bytes', { grant: 'g'.repeat(129) }],
    ['a null grant', { grant: null }],
    ['roles that are not a list', { app_roles: 'manager' }],
    ['an empty role', { app_roles: [''] }],
    ['a role over 128 bytes', { app_roles: ['r'.repeat(129)] }],
    ['a non-string role', { app_roles: [1] }],
    ['an empty active role', { active_role: '' }],
    ['a null active role', { active_role: null }],
  ])('refuses %s', (_name, patch) => {
    expect(code(() => parse(encode(claims(patch))))).toBe('VISITOR_HEADER_INVALID');
  });

  it.each(['ws', 'app', 'runtime', 'sub_type', 'sub', 'grant', 'app_roles'])('refuses a header without %s', (field) => {
    const value = claims();
    delete value[field];
    expect(code(() => parse(encode(value)))).toBe('VISITOR_HEADER_INVALID');
  });
});
