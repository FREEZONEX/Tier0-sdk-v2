import { afterEach, describe, expect, it, vi } from 'vitest';
import mqtt from 'mqtt';
import { Tier0MQClient } from '../../src/mq/client.js';

describe('real mqtt.js synchronous transport failure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('restores the old identity before disconnect and a later connect', async () => {
    vi.stubEnv('TIER0_MQTT_HOST', undefined);
    vi.stubEnv('TIER0_MQTT_PORT', undefined);
    const client = new Tier0MQClient({ host: 'bad host', password: 'sk-per-ws1_old' });
    const failed = client.connect({ password: 'sk-per-ws2_new' });
    client.disconnect();
    await expect(failed).rejects.toThrow();
    const connect = vi.spyOn(mqtt, 'connect').mockImplementationOnce(((_url: unknown, options: any) => {
      expect(options.password).toBe('sk-per-ws1_old');
      expect(options.username).toBe('1&open');
      throw new Error('fixture stops before network');
    }) as any);
    await expect(client.connect({ host: 'broker' })).rejects.toThrow('fixture stops before network');
    expect(connect).toHaveBeenCalledTimes(1);
    client.disconnect();
  });
});
