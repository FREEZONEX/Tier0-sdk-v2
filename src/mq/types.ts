export interface MQTTConfig {
  /**
   * broker 地址。支持三种形态：
   * - 完整 WebSocket URL，如 `wss://host:8084/mqtt`（推荐浏览器场景显式使用）；
   * - 裸 `host`（可含端口，如 `host:8084`）；
   * - 平台 `/openapi/v2/info` 返回的原始 `mqttBroker`（如 `tcp://host:1883`，
   *   建议先用 {@link toWebSocketUrl} 归一后再传入，见 `@tier0/sdk-v2/mq` 的 broker 工具）。
   *
   * 在 Tier0 预览和部署里不要传：SDK 只有在用 `TIER0_MQTT_URL`（`mqtt://`）时才走 TCP 经节点代理，
   * 显式给的 host 会按 WebSocket 连接，经代理连不上。
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
   * Original API key; connect-time changes refresh automatically derived identity fields.
   * Leave it unset in the platform. On the server no password is sent: the
   * node proxy fills in the App credential, and username and clientId come
   * from `TIER0_WORKSPACE_ID`, `TIER0_APP_ID`, `TIER0_RUNTIME`,
   * `TIER0_RELEASE` / `TIER0_SESSION`. In the browser the page runtime gives a
   * fresh token for every connection.
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
