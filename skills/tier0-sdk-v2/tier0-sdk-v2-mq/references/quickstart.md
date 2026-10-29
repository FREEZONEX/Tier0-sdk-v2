# MQTT 连接、订阅与清理

入口：@tier0/sdk-v2/mq。使用 Tier0 平台 Broker 和已授权的真实主题；配置外部采集源转 Source，处理脚本转 Stream。

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| host | string | 完整 ws/wss URL，或通过 toWebSocketUrl 解析 |
| clientId / username / password | string | 显式凭据；不要暴露到日志 |
| reconnectPeriod | number | MQTT 重连间隔，与 HTTP 无重试不同 |
| connectTimeout / keepAlive | number | 连接超时/保活配置 |
| maxBackpressuredDeliveries | number | handler 连续同步返回 false 的退订阈值 |

Broker 可从 system.info().mqttBroker 获取。用 parseMqttBroker/toWebSocketUrl，不手工解析 scheme 或把 TCP 1883 当 WebSocket 端口；显式环境地址优先。平台 Key 可派生身份，但浏览器不得接收长期 App Key。

```ts
import { Tier0MQClient, toWebSocketUrl, type TopicHandler } from '@tier0/sdk-v2/mq';

export async function subscribeTelemetry(
  broker: string, credentials: { clientID: string; username: string; password: string },
  filter: string, onValue: (topic: string, value: unknown) => void,
  onError: (error: Error) => void,
) {
  const mq = new Tier0MQClient({
    host: toWebSocketUrl(broker), clientId: credentials.clientID,
    username: credentials.username, password: credentials.password,
    reconnectPeriod: 1000, maxBackpressuredDeliveries: 10,
  });
  const handler: TopicHandler = (topic, payload) => {
    let value: unknown;
    try { value = JSON.parse(payload); }
    catch { onError(new Error('消息不是有效 JSON')); return; }
    onValue(topic, value);
  };
  mq.on('error', onError);
  try {
    await mq.connect();
    mq.subscribe(filter, handler);
  } catch (error) {
    mq.disconnect();
    throw error;
  }
  return () => { mq.unsubscribe(filter, handler); mq.disconnect(); };
}
```

回调是 (topic,payload)，payload 为字符串。subscribe 返回 void，订阅失败通过 error 事件，不把函数返回当 broker SUBACK。此例独占连接；共享连接只退订自己的 handler，不关闭其他消费者。

+ 匹配一层，# 匹配多层，订阅范围必须属于任务和主题授权。不能从旧 v1 的 Metric/Action/State 路径、enableHistory 或字段规则推断新 UNS MQTT 映射；先核实目标平台的实际主题和消息契约。App 服务端订阅新 UNS Record 变更用 `@tier0/sdk-v2/data` 的 `data.subscribe`（`records:subscribe` 服务端推送），不是 MQTT 主题。

## 发布

```ts
import { Tier0MQClient } from '@tier0/sdk-v2/mq';

export async function publishEvent(mq: Tier0MQClient, topic: string, eventId: string, value: number) {
  if (!Number.isFinite(value)) throw new Error('测量值非法');
  await mq.publish(topic, { eventId, value }, { qos: 1, retain: false });
}
```

payload 必须符合实际主题契约；对象用 JSON.stringify，不可包含 bigint。publish resolve 不证明已收 PUBACK，更不证明设备执行；业务闭环用关联 ID/ACK 或独立交互 SDK 的 Stream 请求。订阅 QoS 1，发布默认 QoS 0/retain=false，消费端考虑重复消息。

## 事件、背压和鉴权

connect/disconnect/error/message/subscriptionDropped 反映客户端状态。isConnected/subscribedTopics 不是服务器全量状态。连续同步返回严格 false 才触发背压计数，Promise<false> 不等价；消费者不应无限缓存。

创建凭据用 client.mqttAuth.create({name})，撤销用 delete({id})，检查 success。回执的 clientID 对应配置 clientId；完整密码只在创建时返回一次，受控保存。

Not authorized/CONNACK 5/重连循环时核对注入的 Key 类型、过期/撤销、授权和 Broker ws/wss 地址。v2 不回退 Enterprise 身份，也不套用旧包升级到 @tier0/sdk@latest 的建议；不因连接失败自动新建凭据。
