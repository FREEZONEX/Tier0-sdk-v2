# 协议与连接配置

先调用 source.protocols.list({}) 核对目标能力。Cloud / Enterprise 统一使用 SourceDefinition：顶层 role、endpoint、runtimeLocation，以及协议专属 http/sql/mqtt/modbus 等。没有旧 config/options/auth/material 层。HTTP 使用 http-api，OAuth 使用 oauth2，SQL 使用 edge-sql，Modbus TCP 使用 modbus-tcp。角色默认 client；server 使用目标支持的托管 endpoint。

```ts
import { createClient, type SourceDefinition } from '@tier0/sdk-v2';

export async function inspectProtocolExamples() {
  const capabilities = await createClient().source.protocols.list({});
  const examples: SourceDefinition[] = [
    { name: 'orders-http', protocol: 'http-api', role: 'client',
      endpoint: 'https://orders.example.com', http: { anonymous: true } },
    { name: 'line-plc', protocol: 'modbus-tcp', role: 'client',
      endpoint: 'tcp://plc.example.com:502', modbus: { unitId: 1 } },
    { name: 'line-mqtt', protocol: 'mqtt', role: 'client',
      endpoint: 'mqtt://broker.example.com:1883',
      mqtt: { clientId: 'tier0-line-reader', subscriptions: { 'factory/line1/status': 1 } } },
  ];
  return { capabilities: capabilities.data, examples };
}
```

http.headers 仅放非秘密业务头，不能塞 Authorization/Cookie；http.parameters 保存命名厂商配置。sql.query 或 sql.queries 选择固定声明查询，不在脚本执行任意 SQL。TLS 公共 CA 使用协议 caCertificate；秘密密钥经 credentials.values 本地预配，已有引用使用 credentialRef。extensions.tls 引用只有目标明确支持时可用，不自动关闭 TLS。

以上仅构造配置，不创建 Source。HTTP Server 使用 http://managed，业务路由在 Stream 注册，见[HTTPServer](../../tier0-sdk-v2-stream/references/http-server.md)。配置与凭据创建见[创建](create.md)。
