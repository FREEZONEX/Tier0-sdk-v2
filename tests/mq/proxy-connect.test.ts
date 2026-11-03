import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tier0MQClient } from '../../src/mq/client.js';

/** What the node proxy reads of an MQTT 3.1.1 CONNECT (design 21.28). */
interface Connect {
  level: number;
  cleanSession: boolean;
  clientId: string;
  username?: string;
  password?: string;
}

function parseConnect(packet: Buffer): Connect {
  if (packet[0] !== 0x10) throw new Error(`not a CONNECT: ${packet[0]}`);
  let offset = 1;
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    const byte = packet[offset++];
    length |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
  }
  const end = offset + length;
  const string = () => {
    const size = packet.readUInt16BE(offset);
    const value = packet.subarray(offset + 2, offset + 2 + size).toString('utf8');
    offset += 2 + size;
    return value;
  };
  if (string() !== 'MQTT') throw new Error('protocol name');
  const level = packet[offset++];
  const flags = packet[offset++];
  offset += 2; // keepalive
  const clientId = string();
  if (flags & 0x04) { string(); string(); } // will topic, will payload
  const username = flags & 0x80 ? string() : undefined;
  const password = flags & 0x40 ? string() : undefined;
  if (offset !== end) throw new Error('trailing bytes in CONNECT');
  return { level, cleanSession: Boolean(flags & 0x02), clientId, username, password };
}

/** A broker that records each CONNECT, accepts it, and can drop every connection. */
class FakeBroker {
  readonly connects: Connect[] = [];
  private readonly sockets = new Set<Socket>();
  private readonly server: Server = createServer((socket) => {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = Buffer.alloc(0);
    let connected = false;
    socket.on('data', (chunk) => {
      if (connected) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const total = 2 + buffer[1];
      if (buffer[1] & 0x80 || buffer.length < total) return;
      connected = true;
      this.connects.push(parseConnect(buffer.subarray(0, total)));
      socket.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
    });
  });
  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `mqtt://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  dropAll(): void { for (const socket of this.sockets) socket.destroy(); }
  async close(): Promise<void> {
    this.dropAll();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

async function until(check: () => boolean, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('MQTT through the node proxy, real mqtt.js (design 21.7)', () => {
  let broker: FakeBroker;
  let url: string;
  let sdk: Tier0MQClient | undefined;

  beforeEach(async () => {
    broker = new FakeBroker();
    url = await broker.listen();
    vi.stubEnv('TIER0_RUNTIME', 'deployed');
    vi.stubEnv('TIER0_API_KEY', undefined);
    vi.stubEnv('TIER0_WORKSPACE_ID', '7205759403792793999');
    vi.stubEnv('TIER0_APP_ID', 'app_1');
    vi.stubEnv('TIER0_RELEASE', 'r1');
    vi.stubEnv('TIER0_SESSION', undefined);
    vi.stubEnv('TIER0_MQTT_HOST', undefined);
    vi.stubEnv('TIER0_MQTT_URL', url);
  });
  afterEach(async () => {
    sdk?.disconnect();
    sdk = undefined;
    vi.unstubAllEnvs();
    await broker.close();
  });

  it('sends CONNECT without a password, with username and clientId from the environment', async () => {
    sdk = new Tier0MQClient();
    await sdk.connect();
    expect(broker.connects).toHaveLength(1);
    const [connect] = broker.connects;
    expect(connect.password).toBeUndefined();
    expect(connect.username).toBe('7205759403792793999&app_1&appcred');
    expect(connect.clientId).toMatch(/^7205759403792793999&a\.app_1\.d\.r1\.[a-z0-9]{16}$/);
    expect(connect.cleanSession).toBe(false);
    expect(connect.level).toBe(4);
  });

  it('uses the session in a Preview clientId', async () => {
    vi.stubEnv('TIER0_RUNTIME', 'preview');
    vi.stubEnv('TIER0_RELEASE', undefined);
    vi.stubEnv('TIER0_SESSION', 'sess_9');
    sdk = new Tier0MQClient();
    await sdk.connect();
    expect(broker.connects[0].clientId).toMatch(/^7205759403792793999&a\.app_1\.p\.sess_9\.[a-z0-9]{16}$/);
    expect(broker.connects[0].password).toBeUndefined();
  });

  it('reconnects with the same identity and still no password', async () => {
    sdk = new Tier0MQClient();
    sdk.on('error', () => undefined);
    await sdk.connect();
    broker.dropAll();
    await until(() => broker.connects.length === 2);
    expect(broker.connects[1]).toEqual(broker.connects[0]);
    expect(broker.connects[1].password).toBeUndefined();
  });

  it('refuses to connect without the platform identity', async () => {
    vi.stubEnv('TIER0_RELEASE', undefined);
    sdk = new Tier0MQClient();
    await expect(sdk.connect()).rejects.toThrow(/TIER0_RELEASE or TIER0_SESSION/);
    expect(broker.connects).toHaveLength(0);
  });
});
