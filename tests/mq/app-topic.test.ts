import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appTopic } from '../../src/mq/index.js';

const APP = '0b9f4b1e-6d0a-4c6b-9f53-2f6d7a1c8e01';

describe('appTopic', () => {
  beforeEach(() => {
    vi.stubEnv('TIER0_APP_ID', APP);
    vi.stubEnv('TIER0_RUNTIME', 'deployed');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['preview', 'deployed'])('builds apps/<TIER0_APP_ID>/%s/<suffix>, the namespace Backend grants that key', runtime => {
    vi.stubEnv('TIER0_RUNTIME', runtime);
    expect(appTopic('alarms/line-1')).toBe(`apps/${APP}/${runtime}/alarms/line-1`);
    expect(appTopic('alarms/#')).toBe(`apps/${APP}/${runtime}/alarms/#`);
    expect(appTopic('+/state')).toBe(`apps/${APP}/${runtime}/+/state`);
    expect(appTopic('#')).toBe(`apps/${APP}/${runtime}/#`);
  });

  it('reads the environment on every call and trims the injected values', () => {
    vi.stubEnv('TIER0_APP_ID', ` ${APP} `);
    vi.stubEnv('TIER0_RUNTIME', ' preview ');
    expect(appTopic('a')).toBe(`apps/${APP}/preview/a`);
    vi.stubEnv('TIER0_RUNTIME', 'deployed');
    expect(appTopic('a')).toBe(`apps/${APP}/deployed/a`);
  });

  it.each([undefined, '', '  ', 'live', 'Deployed', 'production', 'build'])('refuses TIER0_RUNTIME %j instead of guessing a segment', runtime => {
    vi.stubEnv('TIER0_RUNTIME', runtime);
    expect(() => appTopic('alarms/#')).toThrow(/TIER0_RUNTIME "preview" or "deployed"/);
  });

  it.each([undefined, '', 'a/b', 'a+b', 'a#', 'a.b', 'x'.repeat(65)])('refuses TIER0_APP_ID %j that is missing or not one topic level', appId => {
    vi.stubEnv('TIER0_APP_ID', appId);
    expect(() => appTopic('alarms/#')).toThrow(/TIER0_APP_ID/);
  });

  it.each(['', '/alarms', 42, undefined])('refuses suffix %j', suffix => {
    expect(() => appTopic(suffix as string)).toThrow(TypeError);
  });

  it('checks the suffix before the environment', () => {
    vi.stubEnv('TIER0_APP_ID', undefined);
    expect(() => appTopic('')).toThrow(TypeError);
  });
});
