# 服务信息与 MQTT 地址

方法：`system.info()`；POST /openapi/v2/info，无业务参数。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';
import { parseMqttBroker, toWebSocketUrl } from '@tier0/sdk-v2/mq';

export async function inspectService(client: Tier0Client = createClient()) {
  const info = await client.system.info();
  const endpoint = parseMqttBroker(info.mqttBroker);
  return {
    name: info.name, version: info.version, capabilities: info.capabilities,
    mqtt: endpoint && info.mqttBroker ? toWebSocketUrl(info.mqttBroker) : undefined,
  };
}
```

返回已解包对象，name/version/capabilities/mqttBroker 均可能省略。mqttBroker 是连接串，可能裸 host、host:port、tcp://host:1883 或完整 ws/wss，不能直接拼 wss:// 前缀。toWebSocketUrl 保留已有 WebSocket URL；TCP 端口不直接复用为 WebSocket 端口。实际端口/路径由环境决定。

info.capabilities 的简略字符串列表不是就绪证明。进一步读取 client.capabilities.discover 的 releaseEnabled、allowed、state、availability，区分开关、授权与运行能力；详见[系统 Skill](../SKILL.md)。

v1 的 /gw/reload 是内部管理操作，未纳入 v2 公共 SDK，不复制旧 reload 示例，也不在连通性诊断中尝试重载服务。
