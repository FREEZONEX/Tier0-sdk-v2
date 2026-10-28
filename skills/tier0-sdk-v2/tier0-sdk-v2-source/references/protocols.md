# 协议与连接配置

先调用 `source.protocols.list({})`。协议枚举存在不等于目标环境驱动或凭据解析器已就绪。HTTP Source 统一使用 `protocol: 'http-api'`，通过文档的 `config.role: 'client' | 'server'` 区分主动请求和入站服务，与 Enterprise 的一协议两角色模型一致。角色和协议能力以目标环境目录为准；旧 `http` 不作为新建示例。

| 配置字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| role | client / server | HTTP 示例显式指定 | 省略时为 client；Server 使用托管地址和空 options |
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
    { name: 'orders-http', protocol: 'http-api',
      config: { configVersion: 2, role: 'client', endpoint: 'https://orders.example.com', options: {} } },
    { name: 'line-plc', protocol: 'modbus',
      config: { configVersion: 2, endpoint: 'tcp://plc.example.com:502', options: { unitId: 1 } } },
    { name: 'line-mqtt', protocol: 'mqtt',
      config: { configVersion: 2, endpoint: 'mqtt://broker.example.com:1883',
        options: { clientId: 'tier0-line-reader', subscriptions: { 'factory/line1/status': 1 } } } },
  ];
  return { capabilities: capabilities.data, examples };
}
```

HTTP Client 的 options 支持 headers 和 parameters；headers 可包含目录允许的非秘密自定义头，Accept/Content-Type 保留 MIME 校验，认证及传输头保留给服务端，不能塞 Authorization/Cookie。Modbus 寄存器范围和轮询频率在 Stream acquisition 中定义；MQTT QoS 为 0/1/2。认证创建见[创建](create.md)，修改时保留原 auth/tls 引用。

SQL options 包含 tlsMode（verify-full/disable）和 queries（资源名→固定 SQL）；脚本不能替换任意 SQL。OPC UA、SAP、Teamcenter 等按能力和服务端校验配置，不从 HTTP 模板生造字段。不要为通过校验自动移除认证或关闭 TLS。

HTTP Client 示例不能用于 Server。HTTPServer 通过 `source.documents.*` 配置监听源，固定前缀为 `/ingest/v1/{workspaceId}/{sourceId}`；Stream 注册相对业务路由和处理函数，见 [HTTPServer Stream](../../tier0-sdk-v2-stream/references/http-server.md)。旧 `http_push` 不再作为独立模式创建；响应时机在 Stream 层处理。

Cloud 的角色位于 `config.role`；Enterprise 投影的顶层 `role` 不能直接抄入 Cloud 管理文档。Server 配置见[创建](create.md)，以 `http://managed` 和空 options 保存，不从 Client 模板推导。

HTTP Client 的单条 inline 认证支持 basic / bearer / apiKey / oauth2ClientCredentials，method 省略时由服务端按 REQUEST 绑定 Source 基址；显式方法限制保持不变。APIKey 材料为 headerName/value，OAuth 可提供 clientAuthentication。见[创建](create.md)。
