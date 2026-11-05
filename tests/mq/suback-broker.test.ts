import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mqttCurrent from 'mqtt';
import mqtt530 from 'mqtt-v530';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const packet = require('mqtt-packet');

// A local protocol fixture: the actual mqtt.js client sends and receives MQTT
// packets over WebSocket; only CONNACK/SUBACK outcomes are controlled here.
async function broker(grant: (connection: number, attempt: number) => number | number[]) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing broker port');
  let connections = 0;
  let subscribes = 0;
  const sockets = new Set<any>();
  server.on('connection', (socket: any) => {
    const connection = ++connections;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    const parser = packet.parser();
    socket.on('message', (data: Buffer) => parser.parse(data));
    parser.on('packet', (input: any) => {
      if (input.cmd === 'connect') socket.send(packet.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
      if (input.cmd === 'subscribe') {
        const code = grant(connection, ++subscribes);
        const granted = Array.isArray(code) ? code : input.subscriptions.map(() => code);
        // mqtt-packet rejects an empty vector when generating; send the invalid
        // wire bytes directly to verify that both mqtt.js versions fail closed.
        socket.send(granted.length
          ? packet.generate({ cmd: 'suback', messageId: input.messageId, granted })
          : Buffer.from([0x90, 0x02, input.messageId >> 8, input.messageId & 0xff]));
      }
      if (input.cmd === 'unsubscribe') socket.send(packet.generate({ cmd: 'unsuback', messageId: input.messageId }));
      if (input.cmd === 'pingreq') socket.send(packet.generate({ cmd: 'pingresp' }));
    });
  });
  return {
    url: `ws://127.0.0.1:${address.port}/mqtt`,
    counts: () => ({ connections, subscribes }),
    publish: (topic: string, payload: string) => sockets.forEach((s) => s.send(packet.generate({ cmd: 'publish', topic, payload, qos: 0 }))),
    breakConnections: () => sockets.forEach((s) => s.terminate()),
    close: () => new Promise<void>((resolve) => { sockets.forEach((s) => s.terminate()); server.close(() => resolve()); }),
  };
}

describe.each([
  ['current mqtt.js', mqttCurrent],
  ['mqtt.js 5.3.0', mqtt530],
])('MQTT SUBACK with %s', (_name, mqttImplementation) => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanups.splice(0)) await close();
    vi.doUnmock('mqtt');
  });

  async function createClient(url: string) {
    vi.resetModules();
    vi.doMock('mqtt', () => ({ default: mqttImplementation }));
    const { Tier0MQClient } = await import('../../src/mq/client.js');
    return new Tier0MQClient({ host: url, password: 'sk-per-ws1_test', reconnectPeriod: 50 });
  }

  it('removes an initially rejected lazy subscription so the same handler can retry', async () => {
    const b = await broker((_connection, attempt) => attempt === 1 ? 0x80 : 1);
    const client = await createClient(b.url);
    cleanups.push(async () => { client.disconnect(); await b.close(); });
    const errors = vi.fn();
    const handler = vi.fn();
    client.on('error', errors);
    client.subscribe('review/topic', handler);
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(client.subscribedTopics).toEqual([]);
    client.subscribe('review/topic', handler);
    await vi.waitFor(() => expect(b.counts().subscribes).toBe(2));
    expect(client.subscribedTopics).toEqual(['review/topic']);
  });

  it('reports a rejected automatic resubscription after reconnect', async () => {
    const b = await broker((connection) => connection === 1 ? 1 : 0x80);
    const client = await createClient(b.url);
    cleanups.push(async () => { client.disconnect(); await b.close(); });
    const errors = vi.fn();
    client.on('error', errors);
    await client.connect();
    client.subscribe('review/topic', vi.fn());
    await vi.waitFor(() => expect(b.counts().subscribes).toBe(1));
    b.breakConnections();
    await vi.waitFor(() => expect(b.counts().connections).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(b.counts().subscribes).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(errors.mock.calls[0][0].message).toContain('review/topic');
    expect(client.subscribedTopics).toEqual([]);
  });

  it('shares one pending SUBACK across handlers and permits both to retry', async () => {
    const b = await broker((_connection, attempt) => attempt === 1 ? 0x80 : 1);
    const client = await createClient(b.url);
    cleanups.push(async () => { client.disconnect(); await b.close(); });
    const errors = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    client.on('error', errors);
    await client.connect();
    client.subscribe('review/topic', first);
    client.subscribe('review/topic', second);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(b.counts().subscribes).toBe(1);
    expect(client.subscribedTopics).toEqual([]);
    client.subscribe('review/topic', first);
    client.subscribe('review/topic', second);
    await vi.waitFor(() => expect(b.counts().subscribes).toBe(2));
    b.publish('review/topic', 'hello');
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith('review/topic', 'hello'));
    expect(second).toHaveBeenCalledWith('review/topic', 'hello');
  });

  it.each([
    ['missing grants', []],
    ['too many grants', [1, 1]],
  ])('rejects a malformed wire SUBACK with %s and permits retry', async (_name, badGrants) => {
    const b = await broker((_connection, attempt) => attempt === 1 ? badGrants : 1);
    const client = await createClient(b.url);
    cleanups.push(async () => { client.disconnect(); await b.close(); });
    const errors = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    client.on('error', errors);
    await client.connect();
    client.subscribe('review/topic', first);
    client.subscribe('review/topic', second);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(client.subscribedTopics).toEqual([]);
    client.subscribe('review/topic', first);
    client.subscribe('review/topic', second);
    await vi.waitFor(() => expect(b.counts().subscribes).toBe(2));
    b.publish('review/topic', 'ok');
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith('review/topic', 'ok'));
    expect(second).toHaveBeenCalledWith('review/topic', 'ok');
  });
});
