import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tier0MQClient } from '../../src/mq/client.js';

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }));
import mqtt from 'mqtt';

/** Backend share/hostedappkey clientIDPattern: the only clientId it accepts for a hosted App key. */
const BACKEND_HOSTED_CLIENT_ID = /^([1-9][0-9]{0,18})&h\.([A-Za-z0-9_-]{1,64})\.[a-z0-9]{8,32}$/;
const APP = '0b9f4b1e-6d0a-4c6b-9f53-2f6d7a1c8e01';
// Workspace 12345 is "9ix" in base36.
const KEY = 'sk-app-ws9ix_hosted-secret';

function connected() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  (mqtt.connect as ReturnType<typeof vi.fn>).mockReturnValue({
    options: {}, reconnect: vi.fn(), subscribe: vi.fn(), publish: vi.fn(), unsubscribe: vi.fn(),
    end: vi.fn((_force: boolean, done?: () => void) => done?.()),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => { (handlers[event] ??= []).push(handler); }),
  });
  return async (client: Tier0MQClient) => {
    const pending = client.connect();
    for (const handler of handlers.connect ?? []) handler();
    await pending;
    const [, options] = (mqtt.connect as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    return options as { clientId: string; username: string; password?: string };
  };
}

describe('Tier0MQClient identity of a hosted App key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TIER0_RUNTIME', 'deployed');
    vi.stubEnv('TIER0_API_KEY', KEY);
    vi.stubEnv('TIER0_APP_ID', APP);
    vi.stubEnv('TIER0_MQTT_URL', undefined);
    vi.stubEnv('TIER0_MQTT_HOST', 'wss://mqtt.example.com/mqtt');
    vi.stubEnv('TIER0_MQTT_PORT', '443');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses <ws>&h.<app>.<random> with the injected key in an App runtime, which Backend accepts', async () => {
    const options = await connected()(new Tier0MQClient());
    expect(options.username).toBe('12345&open');
    expect(options.password).toBe(KEY);
    expect(options.clientId).toMatch(BACKEND_HOSTED_CLIENT_ID);
    const [, ws, app] = BACKEND_HOSTED_CLIENT_ID.exec(options.clientId)!;
    expect([ws, app]).toEqual(['12345', APP]);
    expect(mqtt.connect).toHaveBeenCalledWith('wss://mqtt.example.com/mqtt', expect.anything());
  });

  it('keeps the clientId of one client across reconnects and gives every client its own', async () => {
    const connect = connected();
    const first = await connect(new Tier0MQClient());
    const second = await connect(new Tier0MQClient());
    expect(first.clientId).not.toBe(second.clientId);
    expect(second.clientId).toMatch(BACKEND_HOSTED_CLIENT_ID);
  });

  it('keeps <ws>&<random> without TIER0_APP_ID', async () => {
    vi.stubEnv('TIER0_APP_ID', undefined);
    const options = await connected()(new Tier0MQClient());
    expect(options.clientId).toMatch(/^12345&[a-z0-9]{8}$/);
    expect(options.clientId).not.toMatch(BACKEND_HOSTED_CLIENT_ID);
  });

  it('keeps <ws>&<random> for an explicit password, even with TIER0_APP_ID', async () => {
    const options = await connected()(new Tier0MQClient({ password: 'sk-per-ws9ix_personal' }));
    expect(options).toMatchObject({ username: '12345&open', password: 'sk-per-ws9ix_personal' });
    expect(options.clientId).toMatch(/^12345&[a-z0-9]{8}$/);
  });

  it('prefers an explicit clientId or username', async () => {
    const connect = connected();
    expect(await connect(new Tier0MQClient({ clientId: '12345&mine' }))).toMatchObject({ clientId: '12345&mine', username: '12345&open' });
    const withUsername = await connect(new Tier0MQClient({ username: '12345&open' }));
    expect(withUsername.clientId).toMatch(/^12345&[a-z0-9]{8}$/);
  });

  it('keeps <ws>&<random> when TIER0_APP_ID cannot be an app segment', async () => {
    for (const app of ['app.with.dots', 'a&b', 'x'.repeat(65)]) {
      vi.stubEnv('TIER0_APP_ID', app);
      const options = await connected()(new Tier0MQClient());
      expect(options.clientId).toMatch(/^12345&[a-z0-9]{8}$/);
    }
  });
});
