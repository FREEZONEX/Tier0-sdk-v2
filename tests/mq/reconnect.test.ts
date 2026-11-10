import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tier0MQClient } from '../../src/mq/client.js';

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }));
import mqtt from 'mqtt';

function fakeMqtt() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  const client = {
    options: {} as Record<string, unknown>,
    reconnect: vi.fn(),
    subscribe: vi.fn(),
    publish: vi.fn(),
    unsubscribe: vi.fn(),
    end: vi.fn((_force: boolean, done?: () => void) => done?.()),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => { (handlers[event] ??= []).push(handler); }),
  };
  (mqtt.connect as any).mockReturnValue(client);
  return { client, emit: (event: string, ...args: unknown[]) => (handlers[event] ?? []).forEach((handler) => handler(...args)) };
}

describe('Tier0MQClient across reconnects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv('TIER0_API_KEY', undefined);
    vi.stubEnv('TIER0_MQTT_HOST', undefined);
    vi.stubEnv('TIER0_MQTT_URL', undefined);
    vi.stubEnv('TIER0_RUNTIME', undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('on the server, through the node proxy', () => {
    beforeEach(() => {
      vi.stubEnv('TIER0_RUNTIME', 'deployed');
      vi.stubEnv('TIER0_WORKSPACE_ID', '42');
      vi.stubEnv('TIER0_APP_ID', 'app_1');
      vi.stubEnv('TIER0_RELEASE', 'r1');
      vi.stubEnv('TIER0_SESSION', undefined);
      vi.stubEnv('TIER0_MQTT_URL', 'mqtt://mqtt.sbx.internal:1883');
    });

    async function connected() {
      const { client, emit } = fakeMqtt();
      const sdk = new Tier0MQClient();
      const pending = sdk.connect();
      emit('connect');
      await pending;
      return { sdk, client, emit };
    }

    it('connects over TCP without a password, identity from the environment, and the four changed options', async () => {
      await connected();
      const [url, options] = (mqtt.connect as any).mock.calls[0];
      expect(url).toBe('mqtt://mqtt.sbx.internal:1883');
      expect(options).toMatchObject({ username: '42&open', clean: false, reconnectOnConnackError: true, reconnectPeriod: 0 });
      expect(options).not.toHaveProperty('password');
      expect(options.clientId).toMatch(/^42&h\.app_1\.[a-z0-9]{16}$/);
    });

    it('uses the same identity in a preview', async () => {
      vi.stubEnv('TIER0_RUNTIME', 'preview');
      vi.stubEnv('TIER0_RELEASE', undefined);
      vi.stubEnv('TIER0_SESSION', 's1');
      await connected();
      expect((mqtt.connect as any).mock.calls[0][1]).toMatchObject({ username: '42&open' });
      expect((mqtt.connect as any).mock.calls[0][1].clientId).toMatch(/^42&h\.app_1\.[a-z0-9]{16}$/);
    });

    it('goes over WebSocket for an explicit host, or a TIER0_MQTT_URL that is not mqtt://', async () => {
      const { client, emit } = fakeMqtt();
      const explicit = new Tier0MQClient({ host: 'mqtt.sbx.internal:1883' });
      const pending = explicit.connect();
      emit('connect');
      await pending;
      expect((mqtt.connect as any).mock.calls[0][0]).toMatch(/^ws:\/\//);
      expect(client).toBeDefined();
      vi.stubEnv('TIER0_MQTT_URL', 'mqtts://mqtt.sbx.internal:8883');
      const tls = new Tier0MQClient();
      const second = tls.connect();
      emit('connect');
      await second;
      expect((mqtt.connect as any).mock.calls[1][0]).toMatch(/^wss?:\/\//);
    });

    it('reconnects the same client with the same identity, still without a password', async () => {
      const { client, emit } = await connected();
      emit('close');
      await vi.advanceTimersByTimeAsync(600);
      expect(client.reconnect).toHaveBeenCalledTimes(1);
      expect(client.options).not.toHaveProperty('password');
      expect(client.options.username).toBe('42&open');
      expect(client.options.clientId).toBe((mqtt.connect as any).mock.calls[0][1].clientId);
      expect(mqtt.connect).toHaveBeenCalledTimes(1);
    });

    it('publishes while disconnected through the same client', async () => {
      const { sdk, client, emit } = await connected();
      emit('close');
      await sdk.publish('a/b', 'x', { qos: 1 });
      expect(mqtt.connect).toHaveBeenCalledTimes(1);
      expect(client.publish).toHaveBeenCalledTimes(1);
    });

    it('never gives up on refused connections, backing off up to 5 minutes', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const sdk = await connected();
      sdk.sdk.on('error', () => undefined);
      for (let i = 0; i < 12; i += 1) {
        sdk.emit('error', Object.assign(new Error('refused'), { code: 5 }));
        sdk.emit('close');
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      }
      expect(sdk.client.reconnect).toHaveBeenCalledTimes(12);
      sdk.emit('close');
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
      expect(sdk.client.reconnect).toHaveBeenCalledTimes(12);
      await vi.advanceTimersByTimeAsync(1);
      expect(sdk.client.reconnect).toHaveBeenCalledTimes(13);
    });

    it('owns resubscription, so mqtt.js does not resubscribe on its own', async () => {
      await connected();
      expect((mqtt.connect as any).mock.calls[0][1]).toMatchObject({ resubscribe: false });
    });

    it('rejects calls waiting for a reconnect on disconnect()', async () => {
      const { sdk, emit } = await connected();
      emit('close');
      const waiting = sdk.connect();
      sdk.disconnect();
      await expect(waiting).rejects.toThrow(/cancelled by disconnect/);
    });

    it('stops reconnecting after disconnect()', async () => {
      const { sdk, client, emit } = await connected();
      emit('close');
      sdk.disconnect();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.reconnect).not.toHaveBeenCalled();
    });
  });
});
