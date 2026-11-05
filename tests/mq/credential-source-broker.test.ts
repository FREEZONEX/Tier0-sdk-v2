import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mqttCurrent from 'mqtt';
import mqtt530 from 'mqtt-v530';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const packet = require('mqtt-packet');

// Real MQTT CONNECT packets over a loopback WebSocket broker; no external broker.
async function broker() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing broker address');
  const seen: { password: string; username: string; clientId: string }[] = [];
  const sockets = new Set<{ terminate(): void }>();
  server.on('connection', (socket: any) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    const parser = packet.parser();
    socket.on('message', (data: Buffer) => parser.parse(data));
    parser.on('packet', (input: any) => {
      if (input.cmd === 'connect') {
        seen.push({ password: input.password?.toString(), username: input.username, clientId: input.clientId });
        socket.send(packet.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
      }
      if (input.cmd === 'pingreq') socket.send(packet.generate({ cmd: 'pingresp' }));
    });
  });
  return {
    url: `ws://127.0.0.1:${address.port}/mqtt`, seen,
    breakConnections: () => { for (const socket of sockets) socket.terminate(); },
    close: () => new Promise<void>(resolve => { for (const socket of sockets) socket.terminate(); server.close(() => resolve()); }),
  };
}

describe.each([['mqtt.js current', mqttCurrent], ['mqtt.js 5.3.0', mqtt530]])('MQTT credential source over %s', (_name, implementation) => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0)) await close();
    vi.unstubAllEnvs();
    vi.doUnmock('mqtt');
  });
  async function setup() {
    vi.resetModules();
    vi.doMock('mqtt', () => ({ default: implementation }));
    vi.stubEnv('TIER0_API_KEY', 'sk-app-ws1_env-a');
    const { Tier0MQClient } = await import('../../src/mq/client.js');
    const b = await broker();
    return { Tier0MQClient, b };
  }

  it('rejects explicit missing connect-time password without sending the environment key', async () => {
    const { Tier0MQClient, b } = await setup();
    const client = new Tier0MQClient({ host: b.url, reconnectPeriod: 40 });
    cleanup.push(async () => { client.disconnect(); await b.close(); });
    await expect(client.connect({ password: undefined })).rejects.toThrow(/password/i);
    expect(b.seen).toEqual([]);
    await client.connect({ password: 'sk-per-ws2_user-b' });
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0]).toMatchObject({ password: 'sk-per-ws2_user-b', username: '2&open' });
    expect(b.seen[0].clientId).toMatch(/^2&/);
  });

  it('rejects an undefined password after a no-argument construction', async () => {
    const { Tier0MQClient, b } = await setup();
    vi.stubEnv('TIER0_MQTT_HOST', b.url);
    const client = new Tier0MQClient();
    cleanup.push(async () => { client.disconnect(); await b.close(); });
    await expect(client.connect({ password: undefined })).rejects.toThrow(/password/i);
    expect(b.seen).toEqual([]);
    const hidden = Object.defineProperty({}, 'password', { value: undefined, enumerable: false });
    await expect(client.connect(hidden)).rejects.toThrow(/password/i);
    expect(b.seen).toEqual([]);
  });

  it('uses the process key only when no password was specified', async () => {
    const { Tier0MQClient, b } = await setup();
    const client = new Tier0MQClient({ host: b.url, reconnectPeriod: 40 });
    cleanup.push(async () => { client.disconnect(); await b.close(); });
    await client.connect();
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0]).toMatchObject({ password: 'sk-app-ws1_env-a', username: '1&open' });
  });

  it('isolates concurrent missing and explicitly supplied user credentials', async () => {
    const { Tier0MQClient, b } = await setup();
    const missing = new Tier0MQClient({ host: b.url });
    const user = new Tier0MQClient({ host: b.url });
    cleanup.push(async () => { missing.disconnect(); user.disconnect(); await b.close(); });
    const [a, other] = await Promise.allSettled([
      missing.connect({ password: undefined }), user.connect({ password: 'sk-per-ws2_user-b' }),
    ]);
    expect(a.status).toBe('rejected');
    expect(other.status).toBe('fulfilled');
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0]).toMatchObject({ password: 'sk-per-ws2_user-b', username: '2&open' });
  });

  it('snapshots a connect-time password accessor once before choosing an identity', async () => {
    const { Tier0MQClient, b } = await setup();
    const client = new Tier0MQClient({ host: b.url });
    cleanup.push(async () => { client.disconnect(); await b.close(); });
    let reads = 0;
    await client.connect({ get password() { return ++reads === 1 ? 'sk-per-ws2_user-b' : undefined; } });
    expect(reads).toBe(1);
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0]).toMatchObject({ password: 'sk-per-ws2_user-b', username: '2&open' });
  });

  it('snapshots a constructor password accessor before deriving the MQTT identity', async () => {
    const { Tier0MQClient, b } = await setup();
    let reads = 0;
    const client = new Tier0MQClient({ host: b.url, get password() { return ++reads === 1 ? 'sk-per-ws2_user-b' : 'sk-app-ws1_env-a'; } });
    cleanup.push(async () => { client.disconnect(); await b.close(); });
    await client.connect();
    expect(reads).toBe(1);
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0]).toMatchObject({ password: 'sk-per-ws2_user-b', username: '2&open' });
  });

  it('rejects an explicit undefined constructor password and accepts a later user key', async () => {
    const { Tier0MQClient, b } = await setup();
    const client = new Tier0MQClient({ host: b.url, password: undefined, reconnectPeriod: 40 });
    cleanup.push(async () => { client.disconnect(); await b.close(); });
    await expect(client.connect()).rejects.toThrow(/password/i);
    expect(b.seen).toEqual([]);
    await client.connect({ password: 'sk-per-ws2_user-b' });
    expect(b.seen[0]).toMatchObject({ password: 'sk-per-ws2_user-b', username: '2&open' });
  });

  it('rejects missing replacement while connected and preserves the existing identity on automatic reconnect', async () => {
    const { Tier0MQClient, b } = await setup();
    const client = new Tier0MQClient({ host: b.url, reconnectPeriod: 200 });
    cleanup.push(async () => { client.disconnect(); await b.close(); });
    await client.connect();
    await expect(client.connect({ password: undefined })).rejects.toThrow(/password/i);
    expect(b.seen).toHaveLength(1);
    b.breakConnections();
    await vi.waitFor(() => expect(client.isConnected).toBe(false), { timeout: 1000, interval: 10 });
    await expect(client.connect({ password: undefined })).rejects.toThrow(/password/i);
    await vi.waitFor(() => expect(b.seen.length).toBeGreaterThanOrEqual(2), { timeout: 2500, interval: 20 });
    expect(b.seen.map(entry => [entry.password, entry.username])).toEqual([
      ['sk-app-ws1_env-a', '1&open'], ['sk-app-ws1_env-a', '1&open'],
    ]);
  });
});
