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

function snapshotConfig(config?: MQTTConfig): MQTTConfig | undefined {
  if (!config) return undefined;
  const snapshot = { ...config };
  // Preserve an explicitly supplied non-enumerable password as well.
  if (Object.hasOwn(config, 'password') && !Object.hasOwn(snapshot, 'password')) snapshot.password = config.password;
  return snapshot;
}

interface Subscription {
  topic: string;
  handler: TopicHandler;
  /** A new subscription awaiting the first successful connection. */
  pendingConnect?: boolean;
  /** handler 连续返回 false（背压）的次数，正常返回时清零。 */
  backpressuredCount?: number;
}

interface TopicSubscriptionAttempt {
  invalidSuback?: boolean;
}

const CANCELLED_BY_DISCONNECT = 'MQTT connection cancelled by disconnect';

export class Tier0MQClient {
  private client: MqttClient | null = null;
  private config: MQTTConfig;
  private explicitClientId: boolean;
  private explicitUsername: boolean;
  private listeners: { [K in keyof MQTTEventMap]?: Array<MQTTEventMap[K]> } = {};
  private subscriptions: Subscription[] = [];
  // One broker subscription (including its pending SUBACK) per topic.
  private topicSubscriptions = new Map<string, TopicSubscriptionAttempt>();
  private pendingTopicPackets = new Map<string, TopicSubscriptionAttempt[]>();
  private sentTopicPackets = new Map<number, TopicSubscriptionAttempt>();
  private connectingPromise: Promise<void> | null = null;
  private rejectPendingConnect: ((error: Error) => void) | null = null;
  private _connected = false;
  /** Bumped by disconnect(); callbacks of an older generation are ignored. */
  private generation = 0;
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
    config = snapshotConfig(config);
    this.explicitClientId = config?.clientId !== undefined;
    this.explicitUsername = config?.username !== undefined;
    const envHost = getEnvVar('TIER0_MQTT_URL') || getEnvVar('TIER0_MQTT_HOST');
    const envPort = getEnvVar('TIER0_MQTT_PORT');

    const host = config?.host || envHost || '';
    const port = config?.port || parseInt(envPort || '8084') || 8084;
    // The browser runtime supplies the password per connection; the node proxy puts in the App's key on the server.
    // An explicitly given password, even undefined, is never replaced by the environment key.
    const password = config && Object.hasOwn(config, 'password')
      ? config.password
      : (this.tokenSource() ? '' : getEnvVar('TIER0_API_KEY')) || '';

    // 从 apiKey 解析 workspaceID，自动生成 clientId 和 username
    const workspaceID = config?.clientId && config?.username
      ? undefined
      : parseWorkspaceIDFromApiKey(password ?? '');

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

  private mqttUrlFor(config: MQTTConfig): string {
    const { host, port, secure } = config;
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
  private tokenSource(config: MQTTConfig | undefined = this.config): 'browser' | 'proxy' | undefined {
    if (config?.password) return undefined;
    if (getPageRuntime()) return 'browser';
    return platformProxyMode() ? 'proxy' : undefined;
  }

  /**
   * Local preflight before a transport exists: address and credentials must
   * be usable. A browser token is fetched per attempt, so nothing to check.
   */
  private validateConnectionConfig(config: MQTTConfig): void {
    if (this.tokenSource(config) === 'browser') return;
    void this.connectionParams(config);
  }

  /**
   * What the next connection presents. In the browser a token is fetched for
   * every attempt: reconnecting with the old one after `exp` is refused
   * (PoC-11). Through the node proxy the same identity reconnects, and the
   * proxy puts in the App's current key.
   */
  private connectionParams(config: MQTTConfig = this.config): ConnectionParams | Promise<ConnectionParams> {
    const source = this.tokenSource(config);
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
      const tcp = envUrl !== undefined && /^mqtt:\/\//i.test(envUrl) && config.host === envUrl;
      // The proxy accepts only `<ws>&open` and `<ws>&h.<app>.<random>`, and puts the App's key in as the password.
      return {
        url: tcp ? envUrl : this.mqttUrlFor(config),
        username: config.username ?? `${identity.ws}&open`,
        clientId: config.clientId ?? `${identity.ws}&h.${identity.app}.${this.clientSuffix}`,
      };
    }
    const { username, clientId, password } = config;
    const url = this.mqttUrlFor(config);
    if (!password || !username || !clientId) {
      throw new Error('Tier0 SDK v2: provide a workspace-encoded API key or explicit MQTT username, clientId and password.');
    }
    return { url, username, clientId, password };
  }

  // 内部确保已连接（懒连接）。已有客户端时只等它重连，绝不另建：
  // 同一 clientId 的新旧客户端会互相顶掉。
  private async ensureConnected(onTransportCreationFailure?: () => void): Promise<void> {
    if (this._connected) return;
    if (this.stopped) throw this.stopped;
    if (this.connectingPromise) return this.connectingPromise;
    if (this.client) {
      return new Promise((resolve, reject) => this.connectWaiters.push({ resolve, reject }));
    }

    this.watchRuntime();
    const generation = this.generation;
    // Synchronous unless a browser token has to be fetched.
    const params = this.connectionParams();
    if (!(params instanceof Promise)) {
      const pending = this.doConnect(params, onTransportCreationFailure);
      // mqtt.connect may throw synchronously before creating a client. Do not
      // retain that already-failed attempt until the rejection microtask runs.
      if (!this.client) return pending;
      this.connectingPromise = pending;
      void pending.catch(() => {
        if (this.connectingPromise === pending) this.connectingPromise = null;
      });
      return pending;
    }
    const connecting = params.then((value) => {
      // disconnect() while the token was being fetched: do not start a transport for it.
      if (this.generation !== generation) throw new Error(CANCELLED_BY_DISCONNECT);
      return this.doConnect(value, onTransportCreationFailure);
    });
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
    const generation = this.generation;
    let params: ConnectionParams;
    try {
      params = await this.connectionParams();
    } catch (error) {
      if (client !== this.client || this.generation !== generation) return;
      this.emit('error', error as Error);
      const code = tokenAuthCode(error);
      if (code && this.tokenSource() === 'browser') this.stop(code);
      else this.scheduleReconnect();
      return;
    }
    if (client !== this.client || this.generation !== generation || this._connected || this.paused || this.stopped) return;
    client.options.username = params.username;
    client.options.clientId = params.clientId;
    if (params.password === undefined) delete client.options.password;
    else client.options.password = params.password;
    client.reconnect();
  }

  private doConnect(params: ConnectionParams, onTransportCreationFailure?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const generation = this.generation;
      this.rejectPendingConnect = reject;
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
        // The SDK owns resubscription so every SUBACK reaches its callback.
        resubscribe: false,
      };

      let client: MqttClient;
      try {
        client = mqtt.connect(params.url, options);
      } catch (err) {
        this.rejectPendingConnect = null;
        onTransportCreationFailure?.();
        reject(err);
        return;
      }
      this.client = client;
      const current = () => this.client === client && this.generation === generation;

      // mqtt.js 5.3 synthesizes the requested QoS if a malformed SUBACK has
      // no grants, and can throw when it contains too many. Track wire packet
      // ids so malformed acknowledgements never become apparent success.
      client.on('packetsend', (packet) => {
        if (!current() || packet.cmd !== 'subscribe' || packet.subscriptions.length !== 1) return;
        const topic = packet.subscriptions[0]?.topic;
        if (!topic || typeof packet.messageId !== 'number') return;
        const queue = this.pendingTopicPackets.get(topic);
        const attempt = queue?.shift();
        if (queue?.length === 0) this.pendingTopicPackets.delete(topic);
        if (attempt) this.sentTopicPackets.set(packet.messageId, attempt);
      });
      client.on('packetreceive', (packet) => {
        if (!current() || packet.cmd !== 'suback' || typeof packet.messageId !== 'number') return;
        const attempt = this.sentTopicPackets.get(packet.messageId);
        this.sentTopicPackets.delete(packet.messageId);
        if (!attempt) return;
        if (!Array.isArray(packet.granted) || packet.granted.length !== 1 ||
            (packet.granted[0] !== 0 && packet.granted[0] !== 1)) {
          attempt.invalidSuback = true;
          // Keep old mqtt.js from indexing past its single requested topic.
          packet.granted = [128];
        }
      });

      client.on('connect', () => {
        if (!current()) return;
        this._connected = true;
        this.clearTopicState();
        for (const sub of this.subscriptions) sub.pendingConnect = false;
        this.connectingPromise = null;
        this.rejectPendingConnect = null;
        this.clearReconnect();
        this.reconnectAttempts = 0;
        this.authRefusals = 0;
        resolve();
        this.emit('connect');
        // 断连重连后自动恢复所有订阅
        if (current()) this.resubscribeAll();
        const waiters = this.connectWaiters;
        this.connectWaiters = [];
        waiters.forEach((waiter) => waiter.resolve());
      });

      client.on('error', (err) => {
        if (!current()) return;
        // Remove failed pending subscriptions before an error listener can
        // synchronously cause this same client to reconnect and resubscribe.
        this.subscriptions = this.subscriptions.filter((sub) => !sub.pendingConnect);
        this.connectingPromise = null;
        this.rejectPendingConnect = null;
        reject(err);
        this.emit('error', err);
        if (!AUTH_REFUSED_CODES.has((err as { code?: unknown }).code)) return;
        this.authRefusals += 1;
        if (this.tokenSource() === 'browser' && this.authRefusals >= MAX_AUTH_REFUSALS) this.stop();
      });

      client.on('disconnect', () => {
        if (!current()) return;
        this._connected = false;
        this.clearTopicState();
        this.emit('disconnect');
      });

      client.on('close', () => {
        if (!current()) return;
        this._connected = false;
        this.clearTopicState();
        this.scheduleReconnect();
      });

      client.on(
        'message',
        (topic: string, payload: Buffer, _packet: mqtt.IPublishPacket) => {
          if (!current()) return;
          const payloadStr = payload.toString();
          // 复制一份快照：handler 触发背压自动退订时会重建 this.subscriptions
          this.subscriptions.slice().forEach((sub) => {
            if (!current() || !this.subscriptions.includes(sub)) return;
            if (this.topicMatch(sub.topic, topic)) {
              try {
                // 公开类型为 void 返回（兼容 async/简写 handler），运行时仅识别严格的 false
                const accepted = (
                  sub.handler as (t: string, p: string) => unknown
                )(topic, payloadStr);
                if (!current() || !this.subscriptions.includes(sub)) return;
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
                if (current()) this.emit('error', e as Error);
              }
            }
          });
        }
      );
    });
  }

  // 显式连接（需要等待连接完成时使用）
  async connect(config?: MQTTConfig): Promise<void> {
    const snapshot = snapshotConfig(config);
    // An explicitly missing password must never reuse a previous or environment key.
    if (snapshot && Object.hasOwn(snapshot, 'password') && snapshot.password === undefined) {
      throw new TypeError('MQTT password was explicitly undefined; provide a credential or omit the password field.');
    }
    // Other undefined fields mean no override, not a request to erase settings.
    const update = snapshot
      ? Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== undefined)) as MQTTConfig
      : undefined;
    if (this.client || this.connectingPromise) {
      // mqtt.js snapshots its connection options. Changing our config while a
      // client exists (connecting, connected or reconnecting) would leave the
      // old credentials in use, including on reconnect. Refuse the change
      // before mutating anything.
      const connectionFields: (keyof MQTTConfig)[] = [
        'host', 'port', 'secure', 'clientId', 'username', 'password',
        'keepAlive', 'reconnectPeriod', 'connectTimeout', 'clean',
      ];
      if (update && connectionFields.some((field) =>
        update[field] !== undefined && update[field] !== this.config[field]
      )) {
        throw new Error('MQTT connection settings cannot change while a client exists; disconnect and create a new client');
      }
      const generation = this.generation;
      // A reconnecting client is waited for, never replaced: the SDK keeps reconnecting it.
      await this.ensureConnected();
      if (this.generation !== generation || !this.client || !this._connected) {
        throw new Error('MQTT connection changed before connect completed');
      }
      if (update) {
        this.config = { ...this.config, ...update };
        if (update.clientId !== undefined) this.explicitClientId = true;
        if (update.username !== undefined) this.explicitUsername = true;
      }
      return;
    }
    const previousConfig = this.config;
    const previousExplicitClientId = this.explicitClientId;
    const previousExplicitUsername = this.explicitUsername;
    const candidate = update ? { ...previousConfig, ...update } : previousConfig;
    const explicitClientId = previousExplicitClientId || update?.clientId !== undefined;
    const explicitUsername = previousExplicitUsername || update?.username !== undefined;
    if (update) {
      const previousPassword = previousConfig.password;
      // A connect-time key may belong to a different workspace. Preserve only
      // caller-supplied identity fields, not values derived from the previous key.
      if (update.password !== undefined && update.password !== previousPassword) {
        const workspaceID = parseWorkspaceIDFromApiKey(update.password);
        if (!explicitClientId) {
          candidate.clientId = workspaceID ? workspaceID + '&' + generateRandomString(8) : undefined;
        }
        if (!explicitUsername) candidate.username = workspaceID ? workspaceID + '&open' : undefined;
      }
    }
    this.validateConnectionConfig(candidate);
    const generation = this.generation;
    this.config = candidate;
    this.explicitClientId = explicitClientId;
    this.explicitUsername = explicitUsername;
    const rollbackBeforeTransport = () => {
      if (!this.client && this.generation === generation && this.config === candidate) {
        this.config = previousConfig;
        this.explicitClientId = previousExplicitClientId;
        this.explicitUsername = previousExplicitUsername;
      }
    };
    try {
      await this.ensureConnected(rollbackBeforeTransport);
    } catch (err) {
      // If no transport was created, the attempted settings have no owner.
      // Do not roll back a newer generation or another caller's settings.
      rollbackBeforeTransport();
      throw err;
    }
    if (this.generation !== generation || !this.client || !this._connected) {
      throw new Error('MQTT connection changed before connect completed');
    }
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

    // Only a subscription made before the first connection completes is
    // undone when that connection fails. One made while the SDK reconnects
    // an existing client is kept and restored after the reconnect.
    const pendingConnect = !this._connected && (!this.client || this.connectingPromise !== null);
    const sub: Subscription = { topic, handler, pendingConnect };
    this.subscriptions.push(sub);
    const generation = this.generation;

    if (this._connected && this.client) {
      this.subscribeTopic(topic, this.client, generation);
    } else {
      // 未连接时触发懒连接（已有客户端时等待它重连），连接成功后 resubscribeAll 会自动 subscribe
      this.ensureConnected().catch((err) => {
        if (this.generation === generation && this.subscriptions.includes(sub)) {
          this.subscriptions = this.subscriptions.filter((item) => item !== sub);
          this.emit('error', err);
        }
      });
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
    const client = this.client;
    const generation = this.generation;

    // 如果该 topic 下已无任何 handler，则向 broker 发送 unsubscribe
    const stillHasHandler = this.subscriptions.some((s) => s.topic === topic);
    if (!stillHasHandler) {
      this.topicSubscriptions.delete(topic);
      client.unsubscribe(topic, (err) => {
        if (this.client !== client || this.generation !== generation) return;
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
    if (this.stopped) throw this.stopped;
    const generation = this.generation;
    // A disconnected client queues the message and sends it after reconnecting.
    if (!this.client) await this.ensureConnected();

    const message =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    const qos = (options?.qos ?? 0) as 0 | 1 | 2;
    const retain = options?.retain ?? false;
    const client = this.client;
    if (this.generation !== generation || !client) {
      throw new Error('MQTT connection changed before publish; message was not submitted');
    }
    client.publish(topic, message, { qos, retain });
  }

  disconnect(): void {
    this.clearReconnect();
    this.offRuntime.forEach((off) => off());
    this.offRuntime = [];
    const generation = ++this.generation;
    const client = this.client;
    this.client = null;
    this._connected = false;
    this.connectingPromise = null;
    const rejectPendingConnect = this.rejectPendingConnect;
    this.rejectPendingConnect = null;
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    this.subscriptions = [];
    this.clearTopicState();
    const cancelled = new Error(CANCELLED_BY_DISCONNECT);
    rejectPendingConnect?.(cancelled);
    waiters.forEach((waiter) => waiter.reject(cancelled));
    if (!client) return;
    client.end(true, () => {
      if (!this.client && this.generation === generation) this.emit('disconnect');
    });
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
    const client = this.client;
    const generation = this.generation;

    // 按 topic 去重，每个 topic 只订阅一次
    const uniqueTopics = Array.from(
      new Set(this.subscriptions.map((s) => s.topic))
    );
    uniqueTopics.forEach((topic) => this.subscribeTopic(topic, client, generation));
  }

  private clearTopicState(): void {
    this.topicSubscriptions.clear();
    this.pendingTopicPackets.clear();
    this.sentTopicPackets.clear();
  }

  private subscribeTopic(topic: string, client: MqttClient, generation: number): void {
    if (this.client !== client || this.generation !== generation || !this._connected ||
        this.topicSubscriptions.has(topic) || !this.subscriptions.some((sub) => sub.topic === topic)) return;
    const attempt: TopicSubscriptionAttempt = {};
    this.topicSubscriptions.set(topic, attempt);
    const pending = this.pendingTopicPackets.get(topic) ?? [];
    pending.push(attempt);
    this.pendingTopicPackets.set(topic, pending);
    client.subscribe(topic, { qos: 1 as 0 | 1 | 2 }, (err, granted) => {
      const queue = this.pendingTopicPackets.get(topic);
      if (queue) {
        const index = queue.indexOf(attempt);
        if (index >= 0) queue.splice(index, 1);
        if (!queue.length) this.pendingTopicPackets.delete(topic);
      }
      if (this.client !== client || this.generation !== generation || this.topicSubscriptions.get(topic) !== attempt) return;
      // mqtt.js 5.3 reports SUBACK failure codes in granted with err=null.
      // A QoS 1 request may only be granted QoS 0 or 1, for this one topic.
      const accepted = Array.isArray(granted) && granted.length === 1 &&
        granted[0]?.topic === topic && (granted[0]?.qos === 0 || granted[0]?.qos === 1);
      if (err || attempt.invalidSuback || !accepted) {
        this.topicSubscriptions.delete(topic);
        // Every handler shares this broker subscription and its SUBACK.
        this.subscriptions = this.subscriptions.filter((sub) => sub.topic !== topic);
        this.emit('error', new Error(`MQTT subscription failed for topic ${topic}`, { cause: err ?? undefined }));
      }
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
