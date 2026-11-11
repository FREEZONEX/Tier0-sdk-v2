# 创建 Source 与导入凭据

`client.source.documents.create` 一次原子提交 `document` 和可选 `credentials`。使用当前目标的 SourceDefinition/SourceCredentials schema；秘密从服务端密钥提供者导入只写 credentials，不放连接 URL、普通 headers、脚本、日志或返回值。

```ts
import { createClient, type Tier0Client, type SourceCredentials, type SourceDefinition } from '@tier0/sdk-v2';

export async function createSource(
  document: SourceDefinition, credentials: SourceCredentials | undefined,
  intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.source.documents.create({
    document, ...(credentials === undefined ? {} : { credentials }),
    dryRun: false, idempotencyKey: intentKey,
  });
  if (!('id' in receipt.data)) throw new Error('Expected a saved Source');
  return receipt;
}
```

提交回执 data 包含 Source ID、revision、配置和观测，可直接复用。`dryRun:true` 只预检，不产生 Source ID。带凭据创建需要幂等键；结果未知先查状态与回执，不能重复新建。

凭据写入由服务端校验当前有效的 `uns.source.credentials`；使用已有获授权身份，不因使用 SDK 另行切换 Key。

## 凭据格式

| kind | 导入字段 |
|---|---|
| basic | username、secret |
| bearer | secret |
| oauth2 | secret 及该授权类型要求的材料；公开参数位于 document.http.oauth |
| custom | values；遵循下面的 HTTP 合同或对应协议 schema |
| certificate / http | 仅目标明确支持的组合，不能因枚举存在就推断已实现 |

新建时导入 credentials，换密使用 [documents.credentials.update](update.md#轮换凭据)。保留用户提供的秘密来源，不在示例中硬编码值。MCP 的 credentialFile/credentialImport 是工具的导入功能，不是 SDK 请求字段。

## 自定义 HTTP 认证头

Cloud 普通 HTTP 不填写 sourceType，声明 `http.authentication:'custom'`。credentials.values **恰好一项，键名就是实际认证头名**：

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createCustomHeaderSource(
  endpoint: string, name: string, apiKey: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  return client.source.documents.create({
    document: { name, protocol: 'http-api', role: 'client', endpoint,
      http: { authentication: 'custom' } },
    credentials: { kind: 'custom', values: { 'X-Plex-Connect-Api-Key': apiKey } },
    dryRun: false, idempotencyKey: intentKey,
  });
}
```

apiKey 参数由服务端密钥提供者传入。不能写成 `values:{apiKey:...}` 并期望自动翻译头名，也不能写成 `values:{headerName:...,value:...}`。Authorization、Cookie、Host 等协议保留头不接受这种认证配置。公开租户或客户头可按上游合同放 http.headers。

Plex 模板使用 `sourceType:'plex-mes'`，其 `credentials:{kind:'custom',values:{apiKey}}` 则是厂商语义合同；宿主注入认证头和 http.parameters.tenantId/pcn。**当前 Cloud 该模板的厂商凭据不能用于普通 source.request**，只能按已发布原生操作调用；改进诊断不代表已接通。需要根下自定义业务路由时采用匹配其认证的普通 HTTP 配置，不直接改 sourceType 后沿用旧厂商凭据引用。Enterprise 以目标发现为准。

## 其他连接

普通 HTTP Bearer 使用 `http.authentication:'bearer'` 和 `{kind:'bearer',secret}`；SQL 使用 edge-sql 与 `{kind:'basic',username,secret}`。参数与 TLS 见[协议配置](protocols.md)。

HTTP Server 的 endpoint 按目标目录使用托管地址（Cloud 为 `http://managed`），不套用 Client 凭据。路由和响应时机在 [Stream](../../tier0-sdk-v2-stream/references/http-server.md) 中声明。

Source 状态按回执与目标能力处理，不能固定追加启用调用。最后按任务验证实际业务读取与 Stream/Collection 结果，连接健康不能替代业务验收。
