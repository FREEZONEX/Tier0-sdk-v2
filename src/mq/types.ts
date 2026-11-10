export interface MQTTConfig {
  /**
   * broker 地址。支持三种形态：
   * - 完整 WebSocket URL，如 `wss://host:8084/mqtt`（推荐浏览器场景显式使用）；
   * - 裸 `host`（可含端口，如 `host:8084`）；
   * - 平台 `/openapi/v2/info` 返回的原始 `mqttBroker`（如 `tcp://host:1883`，
   *   建议先用 {@link toWebSocketUrl} 归一后再传入，见 `@tier0/sdk-v2/mq` 的 broker 工具）。
   *
   * 在 Tier0 预览和部署里不要传：平台注入 `TIER0_MQTT_HOST` / `TIER0_MQTT_PORT`（沙箱能连到的
   * broker 入口），不传 host 时 SDK 读它们（有 `TIER0_MQTT_URL` 时它优先）。
   */
  host?: string;
  /** WebSocket port fallback when host has no embedded WebSocket port. */
  port?: number;
  /**
   * 当 host 不带 ws(s) scheme 时，显式指定用 wss(true) 还是 ws(false)。
   * 缺省自适应：浏览器 https 页面或端口 8084 用 wss，其余用 ws。
   */
  secure?: boolean;
  clientId?: string;
  username?: string;
  /**
   * API key or MQTT password. Explicit undefined is rejected by `connect()`;
   * omit it to keep existing settings. Before the first connection,
   * `connect()` may change it and refreshes automatically derived identity
   * fields; once a client exists, disconnect and create a new client to
   * change it.
   * Leave it unset in the platform: without it the SDK uses `TIER0_API_KEY`,
   * the App's key the platform puts in the server process environment
   * (secret), and derives username and clientId from it. Browsers do not
   * connect to the broker in the platform: the App's server subscribes and
   * forwards what a visitor may see.
   */
  password?: string;
  keepAlive?: number;
  /** Base of the reconnect backoff in milliseconds, capped at 5 minutes; 0 turns reconnecting off. */
  reconnectPeriod?: number;
  connectTimeout?: number;
  /**
   * Defaults to false: the persistent session keeps QoS 1 messages across a
   * reconnect. Messages beyond the broker's offline queue (EMQX default 1000)
   * are still lost.
   */
  clean?: boolean;
  /**
   * 背压保护阈值：handler 连续返回 false（表示下游停滞/消费者已断开）达到
   * 该次数后，SDK 自动移除该订阅并向 broker 退订，避免消息在无消费者的
   * 应用内队列中持续堆积。0 或不设置表示关闭该保护（保持原有行为）。
   */
  maxBackpressuredDeliveries?: number;
}

export type MQTTMessage = {
  topic: string;
  payload: string | Buffer;
  qos: number;
  retain: boolean;
};

export type MQTTEventMap = {
  connect: () => void;
  disconnect: () => void;
  error: (error: Error) => void;
  message: (message: MQTTMessage) => void;
  /** 订阅因持续背压被 SDK 自动移除时触发。 */
  subscriptionDropped: (info: { topic: string; reason: string }) => void;
};
