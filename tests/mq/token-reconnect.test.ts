import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tier0MQClient } from '../../src/mq/client.js';
import type { Tier0Event } from '../../src/page-runtime.js';

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }));
import mqtt from 'mqtt';

const RUNTIME_KEY = Symbol.for('tier0.page-runtime.v1');
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const appToken = (mark: string, claims: Record<string, unknown> = {}) =>
  `${b64({ alg: 'EdDSA' })}.${b64({ typ: 'app-credential', ws: '42', app: 'app_1', runtime: 'deployed', release: 'r1', ...claims })}.${mark}`;

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

describe('Tier0MQClient across token expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv('TIER0_API_KEY', undefined);
    vi.stubEnv('TIER0_MQTT_HOST', undefined);
    vi.stubEnv('TIER0_MQTT_URL', undefined);
    vi.stubEnv('TIER0_CREDENTIALS_FILE', undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete (globalThis as Record<symbol, unknown>)[RUNTIME_KEY];
  });

  describe('on the server', () => {
    let dir: string;
    let file: string;
    const write = (value: string) => {
      const next = join(dir, '.next');
      writeFileSync(next, value);
      renameSync(next, file);
    };
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'tier0-mq-'));
      file = join(dir, 'app-token');
      write(appToken('first'));
      vi.stubEnv('TIER0_CREDENTIALS_FILE', file);
      vi.stubEnv('TIER0_MQTT_URL', 'mqtt://emqx.internal:1883');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    async function connected() {
      const { client, emit } = fakeMqtt();
      const sdk = new Tier0MQClient();
      const pending = sdk.connect();
      emit('connect');
      await pending;
      return { sdk, client, emit };
    }

    it('connects with the token, identity from its claims, and the four changed options', async () => {
      await connected();
      const [url, options] = (mqtt.connect as any).mock.calls[0];
      expect(url).toBe('mqtt://emqx.internal:1883');
      expect(options).toMatchObject({ username: '42&app_1&appcred', password: appToken('first'), clean: false, reconnectOnConnackError: true, reconnectPeriod: 0 });
      expect(options.clientId).toMatch(/^42&a\.app_1\.d\.r1\.[a-z0-9]{16}$/);
    });

    it('uses the session in a preview clientId', async () => {
      write(appToken('p', { runtime: 'preview', release: undefined, session: 's1' }));
      await connected();
      expect((mqtt.connect as any).mock.calls[0][1].clientId).toMatch(/^42&a\.app_1\.p\.s1\.[a-z0-9]{16}$/);
    });

    it('reconnects the same client with the new token and the same clientId', async () => {
      const { client, emit } = await connected();
      write(appToken('second'));
      emit('close');
      await vi.advanceTimersByTimeAsync(600);
      expect(client.reconnect).toHaveBeenCalledTimes(1);
      expect(client.options.password).toBe(appToken('second'));
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

    it('never gives up on refused tokens, backing off up to 5 minutes', async () => {
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

    it('stops reconnecting after disconnect()', async () => {
      const { sdk, client, emit } = await connected();
      emit('close');
      sdk.disconnect();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.reconnect).not.toHaveBeenCalled();
    });
  });

  describe('in the browser', () => {
    function fakeRuntime() {
      const listeners = new Map<Tier0Event, Set<(detail: unknown) => void>>();
      let serial = 0;
      const runtime = {
        version: 't', appId: 'a', policy: 'visible',
        getState: () => 'running',
        getSleepAt: () => null,
        on(event: Tier0Event, listener: (detail: unknown) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
          return () => listeners.get(event)!.delete(listener);
        },
        getMqttToken: vi.fn(async () => {
          serial += 1;
          return { token: `t${serial}`, username: '42&g1&appbrowser', client_id: '42&b.g1.abcd', url: 'wss://emqx.example/mqtt', exp: 0, refresh_at: 0 };
        }),
        reportAuthError: vi.fn(),
        reportMqttFailure: vi.fn() as (() => void) | undefined,
        keepAwake: vi.fn(),
      };
      (globalThis as Record<symbol, unknown>)[RUNTIME_KEY] = runtime;
      return { runtime, fire: (event: Tier0Event) => { for (const listener of [...(listeners.get(event) ?? [])]) listener({}); } };
    }

    async function connected() {
      const page = fakeRuntime();
      const broker = fakeMqtt();
      const sdk = new Tier0MQClient();
      sdk.on('error', () => undefined);
      const pending = sdk.connect();
      await vi.advanceTimersByTimeAsync(0);
      broker.emit('connect');
      await pending;
      return { sdk, ...page, ...broker };
    }

    it('connects with what the front door returned', async () => {
      await connected();
      const [url, options] = (mqtt.connect as any).mock.calls[0];
      expect(url).toBe('wss://emqx.example/mqtt');
      expect(options).toMatchObject({ username: '42&g1&appbrowser', clientId: '42&b.g1.abcd', password: 't1', clean: false });
    });

    it('takes a new token for each reconnect', async () => {
      const { client, emit } = await connected();
      emit('close');
      await vi.advanceTimersByTimeAsync(600);
      expect(client.options.password).toBe('t2');
      expect(client.reconnect).toHaveBeenCalledTimes(1);
    });

    it.each([[{ code: 'signed_out' }, 'signed_out'], [{ status: 403 }, 'unavailable']])('stops when the token endpoint refuses: %j', async (failure, code) => {
      const { client, emit, runtime } = await connected();
      runtime.getMqttToken.mockRejectedValue(failure);
      emit('close');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(client.reconnect).not.toHaveBeenCalled();
      expect(runtime.getMqttToken).toHaveBeenCalledTimes(2);
      expect(runtime.reportAuthError).toHaveBeenCalledWith(code);
    });

    it('keeps retrying when the endpoint merely fails', async () => {
      const { emit, runtime } = await connected();
      runtime.getMqttToken.mockRejectedValue({ status: 503, code: 'access_unverifiable' });
      emit('close');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.getMqttToken.mock.calls.length).toBeGreaterThan(3);
      expect(runtime.reportAuthError).not.toHaveBeenCalled();
    });

    it('stops after 3 refused CONNACKs in a row and reports it', async () => {
      const { client, emit, runtime } = await connected();
      for (let i = 0; i < 3; i += 1) {
        emit('error', Object.assign(new Error('refused'), { code: 5 }));
        emit('close');
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(client.reconnect).toHaveBeenCalledTimes(2);
      expect(runtime.reportMqttFailure).toHaveBeenCalledTimes(1);
      expect(runtime.reportAuthError).not.toHaveBeenCalled();
    });

    it('takes a fresh token after a refusal', async () => {
      const { emit, runtime } = await connected();
      emit('close');
      await vi.advanceTimersByTimeAsync(600);
      expect(runtime.getMqttToken).toHaveBeenLastCalledWith(undefined);
      emit('error', Object.assign(new Error('refused'), { code: 5 }));
      emit('close');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.getMqttToken).toHaveBeenLastCalledWith({ fresh: true });
    });

    it('falls back to grant_expired on a runtime without reportMqttFailure', async () => {
      const { emit, runtime } = await connected();
      runtime.reportMqttFailure = undefined;
      for (let i = 0; i < 3; i += 1) {
        emit('error', Object.assign(new Error('refused'), { code: 5 }));
        emit('close');
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(runtime.reportAuthError).toHaveBeenCalledWith('grant_expired');
    });

    it('pauses on sleeping and reconnects on resumed', async () => {
      const { client, emit, fire } = await connected();
      fire('sleeping');
      emit('close');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.reconnect).not.toHaveBeenCalled();
      fire('resumed');
      await vi.advanceTimersByTimeAsync(600);
      expect(client.reconnect).toHaveBeenCalledTimes(1);
    });

    it('starts again on resumed after being stopped', async () => {
      const { sdk, client, emit, runtime, fire } = await connected();
      runtime.getMqttToken.mockRejectedValueOnce({ code: 'grant_expired' });
      emit('close');
      await vi.advanceTimersByTimeAsync(600);
      await expect(sdk.publish('a/b', 'x')).rejects.toThrow(/stopped/);
      fire('resumed');
      await vi.advanceTimersByTimeAsync(600);
      expect(client.reconnect).toHaveBeenCalledTimes(1);
    });
  });
});
