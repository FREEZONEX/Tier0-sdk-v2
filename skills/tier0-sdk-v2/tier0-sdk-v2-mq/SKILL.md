---
name: tier0-sdk-v2-mq
description: 使用 @tier0/sdk-v2/mq 连接 Tier0 MQTT WebSocket Broker，管理凭证、订阅和发布消息、清理连接及处理背压；不替代 Source 配置或 Stream 执行。
---

# MQTT 实时消息

连接配置、完整订阅生命周期、通配符、发布及鉴权排查见 [Quickstart](references/quickstart.md)。实际 MQTT 主题和消息格式按目标环境确认。

`Tier0MQClient` 从独立子入口导入。它面向消息客户端；配置平台采集连接用 Source，运行处理逻辑用 Stream。HTTP SDK 的“不自动重试”不等于 MQTT 禁用重连或 QoS 重投递。

## 使用已有凭证订阅

```ts
import { Tier0MQClient, toWebSocketUrl, type TopicHandler } from '@tier0/sdk-v2/mq';

export async function watchTopic(
  broker: string,
  credentials: { clientID: string; username: string; password: string },
  topic: string,
  handle: TopicHandler,
) {
  const mq = new Tier0MQClient({
    host: toWebSocketUrl(broker),
    clientId: credentials.clientID,
    username: credentials.username,
    password: credentials.password,
    reconnectPeriod: 1000,
  });
  mq.on('error', error => console.error(error.name));
  await mq.connect();
  mq.subscribe(topic, handle);
  return () => {
    mq.unsubscribe(topic, handle);
    mq.disconnect();
  };
}
```

broker 可来自 `client.system.info().mqttBroker`，先检查字段存在。保留已有 ws/wss URL 的端口和路径；HTTP 页面与 TLS/混合内容策略按实际部署配置，不能简单把 TCP 端口当 WebSocket 端口。

subscribe 返回 void，错误通过 error 事件报告；回调参数是 topic 和字符串 payload。按业务格式解析 JSON，非法消息应隔离处理，避免一条坏消息打断消费。多个组件共享连接时，只清理自己的 handler，不直接 disconnect 其他订阅。

## 凭证生命周期

```ts
import { createClient } from '@tier0/sdk-v2';

export async function provisionMqttCredential(name: string) {
  return createClient().mqttAuth.create({ name });
}
export async function revokeMqttCredential(id: number | bigint) {
  return createClient().mqttAuth.delete({ id });
}
```

仅在任务需要创建凭证时使用 create，普通订阅重用已有受控凭证。完整 username/password/clientID 只在创建时返回一次，按秘密管理，别写日志。SDK 配置的 clientId 小写 d，接口回执的 clientID 大写 ID。

也可从编码了 Workspace 的平台 Key 推导 MQTT 身份；无法解析的 Key 会拒绝连接，不回退到 Enterprise 身份。浏览器场景须使用针对当前用户/主题授权的凭证方案，不能为了省事下发长期 App Key。

## 发布与确认边界

```ts
import { Tier0MQClient } from '@tier0/sdk-v2/mq';

export async function publishMeasurement(mq: Tier0MQClient, topic: string, value: number) {
  if (!Number.isFinite(value)) throw new Error('非法测量值');
  await mq.publish(topic, { value, time: Date.now() }, { qos: 1, retain: false });
}
```

publish 目前在建立连接并调用 MQTT 库发布后返回，不等待业务执行确认，也不保证已收到 broker PUBACK。需要闭环时使用业务 ACK 主题/关联 ID 或独立交互 SDK 的 Stream 请求合同，不能把 Promise resolve 当成设备执行完成。

订阅内部 QoS 为 1；发布默认 QoS 0、retain=false。业务消费者需考虑重复消息。对象 payload 经 JSON.stringify，不能直接包含 bigint；按协议约定编码精确值，不假设 MQTT 自动使用 UNS 的无损 codec。

## 清理与背压

组件卸载/任务结束时用原 handler 退订，连接归当前任务独占时再 disconnect。可配置 maxBackpressuredDeliveries；handler 连续同步返回严格 false 达到阈值后会移除订阅并触发 subscriptionDropped。异步 Promise 的 false 不等同同步背压信号。通过 isConnected/subscribedTopics 观察本地连接状态，不把它当作服务器完整订阅清单。
