# 协议与连接配置

先调用 `source.protocols.list({})`。协议枚举存在不等于目标环境驱动或凭据解析器已就绪。原生 `protocol: 'http'` 与通用投影 `adapter: 'http-api'` 不可混用。

| 配置字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| configVersion | 2 | 是 | 新架构配置快照 |
| endpoint | string | 是 | 地址，不内嵌凭据 |
| options | object | 是 | 协议专用选项 |
| auth.kind | string | 有认证时 | basic/bearer/apiKey/usernamePassword/oauth2ClientCredentials |
| auth.credentialRef | string | 有认证时 | 已存在且可用的凭据引用 |
| tls.caRef / clientIdentityRef | string | 否 | 已存在的 CA/客户端身份引用 |

以下只构造文档，不执行创建；实际地址、主题、设备 unitId 由任务上下文提供。提交前用 documents.create 的 dryRun 校验。

```ts
import { createClient, type CloudSourceDocument } from '@tier0/sdk-v2';

export async function inspectProtocolExamples() {
  const capabilities = await createClient().source.protocols.list({});
  const examples: CloudSourceDocument[] = [
    { name: 'orders-http', protocol: 'http',
      config: { configVersion: 2, endpoint: 'https://orders.example.com', options: {} } },
    { name: 'line-plc', protocol: 'modbus',
      config: { configVersion: 2, endpoint: 'tcp://plc.example.com:502', options: { unitId: 1 } } },
    { name: 'line-mqtt', protocol: 'mqtt',
      config: { configVersion: 2, endpoint: 'mqtt://broker.example.com:1883',
        options: { clientId: 'tier0-line-reader', subscriptions: { 'factory/line1/status': 1 } } } },
  ];
  return { capabilities: capabilities.data, examples };
}
```

HTTP 公开 headers 只允许 Accept/Content-Type，不能塞 Authorization/Cookie。Modbus 寄存器范围和轮询频率在 Stream acquisition 中定义；MQTT QoS 为 0/1/2。认证创建见[创建](create.md)，修改时保留原 auth/tls 引用。

SQL options 包含 tlsMode（verify-full/disable）和 queries（资源名→固定 SQL）；脚本不能替换任意 SQL。OPC UA、SAP、Teamcenter 等按能力和服务端校验配置，不从 HTTP 模板生造字段。不要为通过校验自动移除认证或关闭 TLS。
