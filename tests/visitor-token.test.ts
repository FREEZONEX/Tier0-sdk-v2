import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisitorTokenVerifier, frontdoorKeysFromDir, parseVisitorJwks } from '../src/cloud-server.js';

const pair = () => generateKeyPairSync('ed25519');
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwk = (key: KeyObject, kid: string) => ({ ...key.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' });

function issue(privateKey: KeyObject, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const signed = `${b64({ alg: 'EdDSA', kid: 'k1', ...header })}.${b64({
    iss: 'tier0-frontdoor', aud: 'app:app_1', typ: 'visitor', sub_type: 'employee', sub: 'u1', grant: 'g1', ws: '42',
    runtime: 'deployed', app_roles: ['boss'], active_role: 'boss', iat: now, exp: now + 60, jti: 'j1', ...claims,
  })}`;
  return `${signed}.${sign(null, Buffer.from(signed), privateKey).toString('base64url')}`;
}

describe('visitor token verification v2', () => {
  const main = pair();
  const keys = { keys: () => parseVisitorJwks({ keys: [jwk(main.publicKey, 'k1')] }) };
  const verify = createVisitorTokenVerifier({ appID: 'app_1', keys });

  afterEach(() => vi.unstubAllEnvs());

  it('accepts a valid token and returns its claims', () => {
    expect(verify(issue(main.privateKey))).toMatchObject({
      subType: 'employee', subject: 'u1', grant: 'g1', workspaceID: '42', appID: 'app_1', runtime: 'deployed', appRoles: ['boss'], activeRole: 'boss', verificationKeyID: 'k1',
    });
  });

  it('accepts a machine visitor without a grant', () => {
    expect(verify(issue(main.privateKey, { sub_type: 'machine', sub: 't0w_abc', grant: undefined, app_roles: [], active_role: undefined })).subType).toBe('machine');
  });

  it('does not bind the request body or a release', () => {
    expect(verify(issue(main.privateKey, { release: 'anything' })).subject).toBe('u1');
  });

  const now = Math.floor(Date.now() / 1000);
  it.each([
    ['another issuer', { iss: 'sbx-control' }],
    ['another typ', { typ: 'delegation' }],
    ['another audience', { aud: 'app:other' }],
    ['an unknown subject type', { sub_type: 'admin' }],
    ['expired past the tolerance', { iat: now - 200, exp: now - 140 }],
    ['issued too far ahead', { iat: now + 120, exp: now + 170 }],
    ['living too long', { exp: now + 61 }],
    ['a numeric workspace', { ws: 42 }],
    ['roles that are not a list', { app_roles: 'boss' }],
  ])('refuses %s', (_name, claims) => {
    expect(() => verify(issue(main.privateKey, claims))).toThrow('VISITOR_TOKEN_INVALID');
  });

  it('allows 60 s of clock tolerance', () => {
    expect(verify(issue(main.privateKey, { iat: now - 110, exp: now - 50 })).subject).toBe('u1');
  });

  it('refuses a bad signature, an unknown kid, another algorithm and no token', () => {
    expect(() => verify(issue(pair().privateKey))).toThrow('VISITOR_TOKEN_INVALID');
    expect(() => verify(issue(main.privateKey, {}, { kid: 'k9' }))).toThrow('VISITOR_TOKEN_INVALID');
    expect(() => verify(issue(main.privateKey, {}, { alg: 'none' }))).toThrow('VISITOR_TOKEN_INVALID');
    expect(() => verify(null)).toThrow('VISITOR_TOKEN_INVALID');
    expect(() => verify('a.b')).toThrow('VISITOR_TOKEN_INVALID');
  });

  it('reports a verifier with no App as a configuration error, not as a bad token', () => {
    vi.stubEnv('TIER0_CREDENTIALS_FILE', undefined);
    vi.stubEnv('TIER0_APP_ID', undefined);
    expect(() => createVisitorTokenVerifier({ keys })(issue(main.privateKey))).toThrow('VISITOR_TOKEN_CONFIGURATION_INVALID');
  });

  describe('keys from TIER0_JWKS_DIR', () => {
    let dir: string;
    const write = (body: string) => {
      const next = join(dir, '.tier0-frontdoor.json.tmp');
      writeFileSync(next, body);
      renameSync(next, join(dir, 'tier0-frontdoor.json'));
    };
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tier0-jwks-')); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('sees a new kid on the next verification, without a restart', () => {
      write(JSON.stringify({ keys: [jwk(main.publicKey, 'k1')] }));
      vi.stubEnv('TIER0_JWKS_DIR', dir);
      const fromDir = createVisitorTokenVerifier({ appID: 'app_1' });
      expect(fromDir(issue(main.privateKey)).subject).toBe('u1');
      const next = pair();
      expect(() => fromDir(issue(next.privateKey, {}, { kid: 'k2' }))).toThrow('VISITOR_TOKEN_INVALID');
      write(JSON.stringify({ keys: [jwk(main.publicKey, 'k1'), jwk(next.publicKey, 'k2')] }));
      expect(fromDir(issue(next.privateKey, {}, { kid: 'k2' })).subject).toBe('u1');
    });

    it('keeps the last good keys while a replacement cannot be parsed', () => {
      write(JSON.stringify({ keys: [jwk(main.publicKey, 'k1')] }));
      const source = frontdoorKeysFromDir(dir);
      expect(source.keys().has('k1')).toBe(true);
      write('{');
      expect(source.keys().has('k1')).toBe(true);
    });

    it('refuses every token while the file is missing', () => {
      expect(frontdoorKeysFromDir(dir).keys().size).toBe(0);
    });

    it('needs the directory configured', () => {
      vi.stubEnv('TIER0_JWKS_DIR', undefined);
      expect(() => frontdoorKeysFromDir()).toThrow('VISITOR_TOKEN_CONFIGURATION_INVALID');
    });
  });
});
