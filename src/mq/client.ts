import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';
import { platformIdentity, platformProxyMode } from '../platform-proxy.js';
import { getPageRuntime, isAuthErrorCode, onPageRuntime, reportAuthError, type Tier0AuthErrorCode } from '../page-runtime.js';
import { getEnvVar } from '../runtime-env.js';
import { DEFAULT_WSS_PORT, isBrowserHttps, parseMqttBroker, toWebSocketUrl } from './broker.js';
import type { MQTTConfig, MQTTEventMap } from './types.js';

/** Design 21.6: backoff ceiling of a client that never gives up. */
const RECONNECT_MAX_MS = 5 * 60_000;
/** A reconnect right after the token's `exp` is spread over this window. */
const FIRST_RECONNECT_MS = 500;
/** Design 21.6: refused this many times in a row, a browser stops reconnecting. */
const MAX_AUTH_REFUSALS = 3;
/** CONNACK codes for bad credentials: MQTT 3.1.1 (4, 5), MQTT 5 (134, 135). */
const AUTH_REFUSED_CODES: ReadonlySet<unknown> = new Set([4, 5, 134, 135]);
/** What a runtime without `reportMqttFailure()` hears instead (design 21.3). */
const REFUSED_AUTH_ERROR: Tier0AuthErrorCode = 'grant_expired';

/** One connection attempt: what the broker sees. No password through the node proxy, which fills it in. */
interface ConnectionParams {
  url: string;
  username: string;
  clientId: string;
  password?: string;
}

/** A stopped client: the platform refused it, and retrying cannot help. */
class StoppedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Tier0MQStoppedError';
  }
}

/** The authorization code of a failed `getMqttToken()`, a `Tier0RuntimeError{status, code}` (design 21.3). */
function tokenAuthCode(error: unknown): Tier0AuthErrorCode | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof code === 'string' && isAuthErrorCode(code)) return code;
  if (status === 401) return 'grant_expired';
  if (status === 403) return 'unavailable';
  return undefined;
}

/**
 * 消息回调。公开类型保持 `void` 返回，以兼容 async handler、`push()` 简写等
 * 既有写法；运行时额外识别返回值：handler 返回严格的 `false` 视为下游停滞
 * （背压），SDK 会统计连续背压次数，配合 MQTTConfig.maxBackpressuredDeliveries
 * 可在阈值内自动移除订阅。
 */
export type TopicHandler = (topic: string, payload: string) => void;

function parseWorkspaceIDFromApiKey(apiKey: string): string | undefined {
  // Match the backend's sk-<type>-ws<base36>_<secret> contract, not only
  // service keys. Other workspace-encoded keys use the same MQTT identity.
  const match = /^sk-[^-]+-ws([0-9a-zA-Z]+)_.+$/.exec(apiKey.trim());
  if (!match) return undefined;

  // Keep the int64 workspace ID exact; parseInt can round IDs above 2^53.
  let workspaceID = 0n;
  for (const digit of match[1]) {
    workspaceID = workspaceID * 36n + BigInt(parseInt(digit, 36));
    if (workspaceID > 9223372036854775807n) return undefined;
  }
  return workspaceID > 0n ? workspaceID.toString() : undefined;
}

function generateRandomString(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

interface Subscription {
  topic: string;
  handler: TopicHandler;
  /** handler 连续返回 false（背压）的次数，正常返回时清零。 */
  backpressuredCount?: number;
}

export class Tier0MQClient {
  private client: MqttClient | null = null;
  private config: MQTTConfig;
  private explicitClientId: boolean;
  private explicitUsername: boolean;
  private listeners: { [K in keyof MQTTEventMap]?: Array<MQTTEventMap[K]> } = {};
  private subscriptions: Subscription[] = [];
  private connectingPromise: Promise<void> | null = null;
  private _connected = false;
  /** Random clientId segment; a persistent session is found again through it. */
  private readonly clientSuffix = generateRandomString(16);
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private authRefusals = 0;
  /** Paused by the page runtime's `sleeping` until `resumed`. */
  private paused = false;
  private stopped: StoppedError | null = null;
  private offRuntime: Array<() => void> = [];
  private connectWaiters: Array<{ resolve(): void; reject(error: Error): void }> = [];

  constructor(config?: MQTTConfig) {
    this.explicitClientId = config?.clientId !== undefined;
    this.explicitUsername = config?.username !== undefined;
    const envHost = getEnvVar('TIER0_MQTT_URL') || getEnvVar('TIER0_MQTT_HOST');
    const envPort = getEnvVar('TIER0_MQTT_PORT');

    const host = config?.host || envHost || '';
    const port = config?.port || parseInt(envPort || '8084') || 8084;
    // The browser runtime supplies the password per connection; the node proxy puts in the App's key on the server.
    const password = config?.password || (this.tokenSource() ? '' : getEnvVar('TIER0_API_KEY')) || '';

    // 从 apiKey 解析 workspaceID，自动生成 clientId 和 username
    const workspaceID = config?.clientId && config?.username
      ? undefined
      : parseWorkspaceIDFromApiKey(password);

    const autoClientId = workspaceID
      ? `${workspaceID}&${generateRandomString(8)}`
      : undefined;
    const autoUsername = workspaceID
      ? `${workspaceID}&open`
      : undefined;

    this.config = {
      host,
      port,
      clientId: config?.clientId || autoClientId,
      username: config?.username || autoUsername,
      password,
      keepAlive: config?.keepAlive ?? 60,
      reconnectPeriod: config?.reconnectPeriod ?? 5000,
      connectTimeout: config?.connectTimeout ?? 30000,
      ...config,
      clean: config?.clean ?? false,
    };
  }

  private get mqttUrl(): string {
    const { host, port, secure } = this.config;
    if (!host) {
      throw new Error(
        'MQTT host is required. Provide it via MQTTConfig or TIER0_MQTT_HOST environment variable.'
      );
    }
    const normalizedHost = host.trim().replace(/\/+$/, '');
    if (/^wss?:\/\//i.test(normalizedHost)) {
      const url = toWebSocketUrl(normalizedHost);
      if (!url) throw new TypeError('Invalid MQTT WebSocket URL');
      return url;
    }
    // 裸 host（可含端口）：按运行环境自适应 ws/wss
    const endpoint = parseMqttBroker(normalizedHost);
    const hostname = endpoint?.hostname ?? normalizedHost;
    // 裸 host:port 和 ws(s) URL 的端口按 WebSocket 端口处理；
    // tcp/mqtt/mqtts 的端口是 TCP 端口（如 1883），wss 下不能沿用，回退到配置的 port
    const effectivePort =
      !endpoint?.scheme || endpoint.scheme === 'ws' || endpoint.scheme === 'wss'
        ? endpoint?.port ?? port
        : port;
    const useSecure = secure ?? (isBrowserHttps() || effectivePort === DEFAULT_WSS_PORT);
    return `${useSecure ? 'wss' : 'ws'}://${hostname}:${effectivePort}/mqtt`;
  }

  /**
   * Where the credential comes from; undefined when a fixed password is used.
   * `proxy`: platform proxy mode, the node proxy puts in the App's key and
   * the SDK sends none.
   */
  private tokenSource(): 'browser' | 'proxy' | undefined {
    if (this.config?.password) return undefined;
    if (getPageRuntime()) return 'browser';
    return platformProxyMode() ? 'proxy' : undefined;
  }

  /**
   * What the next connection presents. In the browser a token is fetched for
   * every attempt: reconnecting with the old one after `exp` is refused
   * (PoC-11). Through the node proxy the same identity reconnects, and the
   * proxy puts in the App's current key.
   */
  private connectionParams(): ConnectionParams | Promise<ConnectionParams> {
    const source = this.tokenSource();
    if (source === 'browser') {
      // After a refusal the cached token is the likely culprit.
      return getPageRuntime()!.getMqttToken(this.authRefusals > 0 ? { fresh: true } : undefined).then((issued) => ({
        url: issued.url, username: issued.username, clientId: issued.client_id, password: issued.token,
      }));
    }
    if (source === 'proxy') {
      const identity = platformIdentity();
      if (!identity) {
        throw new Error('Tier0 SDK v2: TIER0_WORKSPACE_ID and TIER0_APP_ID are required for MQTT in the platform.');
      }
      // Only `mqtt://` from the platform goes over TCP to the proxy; an explicit host means WebSocket.
      const envUrl = getEnvVar('TIER0_MQTT_URL')?.trim();
      const tcp = envUrl !== undefined && /^mqtt:\/\//i.test(envUrl) && this.config.host === envUrl;
      // The proxy accepts only `<ws>&open` and `<ws>&h.<app>.<random>`, and puts the App's key in as the password.
      return {
        url: tcp ? envUrl : this.mqttUrl,
        username: this.config.username ?? `${identity.ws}&open`,
        clientId: this.config.clientId ?? `${identity.ws}&h.${identity.app}.${this.clientSuffix}`,
      };
    }
    const { username, clientId, password } = this.config;
    const url = this.mqttUrl;
    if (!password || !username || !clientId) {
      throw new Error('Tier0 SDK v2: provide a workspace-encoded API key or explicit MQTT username, clientId and password.');
    }
    return { url, username, clientId, password };
  }

  // 内部确保已连接（懒连接）。已有客户端时只等它重连，绝不另建：
  // 同一 clientId 的新旧客户端会互相顶掉。
  private async ensureConnected(): Promise<void> {
    if (this._connected) return;
    if (this.stopped) throw this.stopped;
    if (this.connectingPromise) return this.connectingPromise;
    if (this.client) {
      return new Promise((resolve, reject) => this.connectWaiters.push({ resolve, reject }));
    }

    this.watchRuntime();
    // Synchronous unless a browser token has to be fetched.
    const params = this.connectionParams();
    const connecting = params instanceof Promise ? params.then((value) => this.doConnect(value)) : this.doConnect(params);
    this.connectingPromise = connecting;
    return connecting.catch((error: unknown) => {
      if (this.connectingPromise === connecting) this.connectingPromise = null;
      throw this.refuse(error);
    });
  }

  /** Stops on an authorization failure of the token endpoint; other failures pass through. */
  private refuse(error: unknown): unknown {
    const code = tokenAuthCode(error);
    if (!code || this.tokenSource() !== 'browser') return error;
    this.stop(code);
    return this.stopped;
  }

  /** `code` undefined: the broker refused fresh tokens, and the runtime finds out whether authorization really failed. */
  private stop(code?: Tier0AuthErrorCode): void {
    this.stopped = new StoppedError(`Tier0 SDK v2: MQTT stopped reconnecting (${code ?? 'refused by the broker'}).`);
    this.clearReconnect();
    const runtime = getPageRuntime();
    if (!code && runtime?.reportMqttFailure) runtime.reportMqttFailure();
    else reportAuthError(code ?? REFUSED_AUTH_ERROR);
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    waiters.forEach((waiter) => waiter.reject(this.stopped!));
    this.emit('error', this.stopped);
  }

  /** Design 21.6: no reconnects while the App sleeps; `resumed`, a reauthorization included, starts them again. */
  private watchRuntime(): void {
    if (this.offRuntime.length > 0 || !getPageRuntime()) return;
    this.offRuntime = [
      onPageRuntime('sleeping', () => {
        this.paused = true;
        this.clearReconnect();
      }),
      onPageRuntime('resumed', () => {
        this.paused = false;
        this.stopped = null;
        this.authRefusals = 0;
        this.reconnectAttempts = 0;
        if (this.client && !this._connected) this.scheduleReconnect();
      }),
    ];
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private reconnectDelay(): number {
    const attempt = this.reconnectAttempts;
    this.reconnectAttempts += 1;
    if (attempt === 0) return Math.random() * FIRST_RECONNECT_MS;
    const base = this.config.reconnectPeriod ?? 5000;
    const ceiling = Math.min(RECONNECT_MAX_MS, base * 2 ** (attempt - 1));
    return ceiling / 2 + Math.random() * (ceiling / 2);
  }

  private scheduleReconnect(): void {
    if (!this.client || this._connected || this.paused || this.stopped || this.reconnectTimer !== null) return;
    if (this.config.reconnectPeriod === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, this.reconnectDelay());
  }

  /** The same client, with a new token in the browser: mqtt.js keeps its session and offline queue. */
  private async reconnect(): Promise<void> {
    const client = this.client;
    if (!client) return;
    let params: ConnectionParams;
    try {
      params = await this.connectionParams();
    } catch (error) {
      this.emit('error', error as Error);
      const code = tokenAuthCode(error);
      if (code && this.tokenSource() === 'browser') this.stop(code);
      else this.scheduleReconnect();
      return;
    }
    if (client !== this.client || this._connected || this.paused || this.stopped) return;
    client.options.username = params.username;
    client.options.clientId = params.clientId;
    if (params.password === undefined) delete client.options.password;
    else client.options.password = params.password;
    client.reconnect();
  }

  private doConnect(params: ConnectionParams): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: IClientOptions = {
        clientId: params.clientId,
        username: params.username,
        ...(params.password === undefined ? {} : { password: params.password }),
        keepalive: this.config.keepAlive,
        // Reconnects are ours: mqtt.js's timer cannot wait for a new token.
        reconnectPeriod: 0,
        // Without it a refused CONNACK leaves the client disconnected for good.
        reconnectOnConnackError: true,
        connectTimeout: this.config.connectTimeout,
        clean: this.config.clean,
      };

      const client = mqtt.connect(params.url, options);
      this.client = client;

      client.on('connect', () => {
        this._connected = true;
        this.connectingPromise = null;
        this.clearReconnect();
        this.reconnectAttempts = 0;
        this.authRefusals = 0;
        this.emit('connect');
        // 断连重连后自动恢复所有订阅
        this.resubscribeAll();
        resolve();
        const waiters = this.connectWaiters;
        this.connectWaiters = [];
        waiters.forEach((waiter) => waiter.resolve());
      });

      client.on('error', (err) => {
        this.emit('error', err);
        this.connectingPromise = null;
        reject(err);
        if (!AUTH_REFUSED_CODES.has((err as { code?: unknown }).code)) return;
        this.authRefusals += 1;
        if (this.tokenSource() === 'browser' && this.authRefusals >= MAX_AUTH_REFUSALS) this.stop();
      });

      client.on('disconnect', () => {
        this._connected = false;
        this.emit('disconnect');
      });

      client.on('close', () => {
        this._connected = false;
        if (client === this.client) this.scheduleReconnect();
      });

      client.on(
        'message',
        (topic: string, payload: Buffer, _packet: mqtt.IPublishPacket) => {
          const payloadStr = payload.toString();
          // 复制一份快照：handler 触发背压自动退订时会重建 this.subscriptions
          this.subscriptions.slice().forEach((sub) => {
            if (this.topicMatch(sub.topic, topic)) {
              try {
                // 公开类型为 void 返回（兼容 async/简写 handler），运行时仅识别严格的 false
                const accepted = (
                  sub.handler as (t: string, p: string) => unknown
                )(topic, payloadStr);
                if (accepted === false) {
                  sub.backpressuredCount = (sub.backpressuredCount ?? 0) + 1;
                  const limit = this.config.maxBackpressuredDeliveries ?? 0;
                  if (limit > 0 && sub.backpressuredCount >= limit) {
                    this.unsubscribe(sub.topic, sub.handler);
                    this.emit('subscriptionDropped', {
                      topic: sub.topic,
                      reason: `handler 连续 ${sub.backpressuredCount} 次返回背压（false），已按 maxBackpressuredDeliveries=${limit} 自动退订`,
                    });
                  }
                } else {
                  sub.backpressuredCount = 0;
                }
              } catch (e) {
                this.emit('error', e as Error);
              }
            }
          });
        }
      );
    });
  }

  // 显式连接（需要等待连接完成时使用）
  async connect(config?: MQTTConfig): Promise<void> {
    if (config) {
      const previousPassword = this.config.password;
      this.config = { ...this.config, ...config };
      if (config.clientId !== undefined) this.explicitClientId = true;
      if (config.username !== undefined) this.explicitUsername = true;
      // A connect-time key may belong to a different workspace. Preserve only
      // caller-supplied identity fields, not values derived from the previous key.
      if (config.password !== undefined && config.password !== previousPassword) {
        const workspaceID = parseWorkspaceIDFromApiKey(config.password);
        if (!this.explicitClientId) {
          this.config.clientId = workspaceID ? workspaceID + '&' + generateRandomString(8) : undefined;
        }
        if (!this.explicitUsername) this.config.username = workspaceID ? workspaceID + '&open' : undefined;
      }
    }
    return this.ensureConnected();
  }

  // 订阅 topic，内部 qos 固定为 1，handler 接收 (topic, payload)
  // 无需先调用 connect()，自动处理连接
  subscribe(topic: string, handler: TopicHandler): void {
    // 避免重复注册同一 topic 的同一 handler
    const exists = this.subscriptions.some(
      (s) => s.topic === topic && s.handler === handler
    );
    if (exists) {
      return;
    }

    this.subscriptions.push({ topic, handler });

    if (this._connected && this.client) {
      this.client.subscribe(topic, { qos: 1 as 0 | 1 | 2 }, (err) => {
        if (err) {
          this.emit('error', err);
          // 订阅失败时回滚
          this.subscriptions = this.subscriptions.filter(
            (s) => !(s.topic === topic && s.handler === handler)
          );
        }
      });
    } else {
      // 未连接时触发懒连接，连接成功后 resubscribeAll 会自动 subscribe
      this.ensureConnected().catch((err) => this.emit('error', err));
    }
  }

  // 取消订阅：如果提供了 handler 则仅移除该 handler，否则移除该 topic 下所有 handler
  unsubscribe(topic: string, handler?: TopicHandler): void {
    if (handler) {
      this.subscriptions = this.subscriptions.filter(
        (s) => !(s.topic === topic && s.handler === handler)
      );
    } else {
      this.subscriptions = this.subscriptions.filter((s) => s.topic !== topic);
    }

    if (!this.client) return;

    // 如果该 topic 下已无任何 handler，则向 broker 发送 unsubscribe
    const stillHasHandler = this.subscriptions.some((s) => s.topic === topic);
    if (!stillHasHandler) {
      this.client.unsubscribe(topic, (err) => {
        if (err) {
          this.emit('error', err);
        }
      });
    }
  }

  // 发布消息，无需先调用 connect()，内部自动处理连接
  async publish(
    topic: string,
    payload: string | object,
    options?: { qos?: number; retain?: boolean }
  ): Promise<void> {
    // A disconnected client queues the message and sends it after reconnecting.
    if (this.stopped) throw this.stopped;
    if (!this.client) await this.ensureConnected();

    const message =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client!.publish(topic, message, {
      qos: (options?.qos ?? 0) as 0 | 1 | 2,
      retain: options?.retain ?? false,
    });
  }

  disconnect(): void {
    this.clearReconnect();
    this.offRuntime.forEach((off) => off());
    this.offRuntime = [];
    if (!this.client) return;

    this.client.end(true, () => {
      this.emit('disconnect');
    });
    this.client = null;
    this._connected = false;
    this.connectingPromise = null;
    this.subscriptions = [];
  }

  on<K extends keyof MQTTEventMap>(event: K, handler: MQTTEventMap[K]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(handler);
  }

  off<K extends keyof MQTTEventMap>(event: K, handler: MQTTEventMap[K]): void {
    const handlers = this.listeners[event];
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
  }

  private emit<K extends keyof MQTTEventMap>(
    event: K,
    ...args: Parameters<MQTTEventMap[K]>
  ): void {
    const handlers = this.listeners[event];
    if (!handlers) return;
    handlers.forEach((h) => (h as any)(...args));
  }

  // 断连后自动重新订阅所有已注册的 topic
  private resubscribeAll(): void {
    if (!this.client) return;

    // 按 topic 去重，每个 topic 只订阅一次
    const uniqueTopics = Array.from(
      new Set(this.subscriptions.map((s) => s.topic))
    );
    uniqueTopics.forEach((topic) => {
      this.client!.subscribe(topic, { qos: 1 as 0 | 1 | 2 }, (err) => {
        if (err) {
          this.emit('error', err);
        }
      });
    });
  }

  // 判断接收到的 topic 是否匹配订阅的 topic（支持通配符 # 和 +）
  private topicMatch(subscribed: string, received: string): boolean {
    const subParts = subscribed.split('/');
    const recParts = received.split('/');

    for (let i = 0; i < subParts.length; i++) {
      const sp = subParts[i];
      const rp = recParts[i];

      if (sp === '#') {
        // # 必须是最后一个层级，匹配后面所有
        return true;
      }
      if (sp === '+') {
        // + 匹配单个层级
        continue;
      }
      if (sp !== rp) {
        return false;
      }
    }

    return subParts.length === recParts.length;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get subscribedTopics(): string[] {
    return Array.from(new Set(this.subscriptions.map((s) => s.topic)));
  }
}
