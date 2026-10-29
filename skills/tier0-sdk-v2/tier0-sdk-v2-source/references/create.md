# 创建 Source

方法：`source.documents.create`；POST `/openapi/v2/uns/sources/documents/create`。需要 Source manage 权限。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 是 | true 校验；false 保存 |
| document.name | string | 是 | 1–128 字符 |
| document.protocol | string | 是 | 原生协议，如 http-api、mqtt、modbus |
| document.config.role | client / server | HTTP API 显式指定 | client 主动请求；server 接收入站请求 |
| document.config | object | 是 | endpoint、options；见[协议配置](protocols.md) |
| document.description | string | 否 | 最多 512 字符 |
| credentials | object | 否 | 仅创建 HTTP Client 时提供新凭据，与已有 auth/TLS 引用互斥 |
| idempotencyKey | string | 否 | 建议提供，最多 128 字符，同一业务意图保持不变 |

## 完整示例：HTTP Client 数据源

传入实际端点、名称和意图键。此函数创建 `http-api` + `config.role: client` 配置，不启用源。client 从服务端环境读取 API Host/Key，也可显式注入。

```ts
import { createClient, type Tier0Client, type CloudSourceDocument } from '@tier0/sdk-v2';

export async function createHttpSource(
  endpoint: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const document: CloudSourceDocument = {
    name, protocol: 'http-api', description: '订单系统 HTTP 接入',
    config: { role: 'client', endpoint, options: {} },
  };
  const saved = await client.source.documents.create({
    dryRun: false, document, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存的 Source');
  return { receipt: saved, current: saved.data };
}
```

一次提交即可返回完整 data：id、revision、document、desiredState、runtimeState、health、createdAt、updatedAt，无需另行 get。需要单独预检时可先传 `dryRun: true`，返回 `{ validated: true, sideEffects: false }`，没有 ID。预检不保留提交条件；实际保存仍会校验。ID 原样保留十进制字符串。

HTTP Server 同样使用 `protocol: http-api`，角色为 `config.role: server`；其配置以 `source.protocols.list({})` 返回的正式合同为准，不能复用下方 Client 的主动请求示例。入站业务统一绑定 HTTPServer Source，路由和响应时机在 Stream 定义；202 状态不能据此报告 Stream 执行完成。

## HTTP Client Bearer 凭据

token 从服务端密钥提供者取得，不写入脚本、文档、日志或仓库。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createAuthenticatedHttpSource(
  endpoint: string, name: string, token: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const saved = await client.source.documents.create({
    dryRun: false, idempotencyKey: intentKey,
    document: { name, protocol: 'http-api', config: { role: 'client', endpoint, options: {} } },
    credentials: { method: 'GET', kind: 'bearer', material: { token } },
  });
  if (!('id' in saved.data)) throw new Error('未返回 Source ID');
  return { receipt: saved, current: saved.data };
}
```

配置保存不代表连接健康；见[查询](read.md)。仅在任务包含启用时执行[启停](state.md)。结果未知时保留原请求、requestId、意图键，先核对列表/历史，不自动重复创建。

## HTTP Server：管理配置

正式协议目录规定 Server 的 `config.endpoint` 为 `http://managed`、`options` 为 `{}`，不携带 Client 的 `auth` / `tls` 或创建专用 `credentials`。该函数只保存 Source，不启用、不创建 Stream，也不发起入站请求。

```ts
import { createClient, type Tier0Client, type CloudSourceDocument } from '@tier0/sdk-v2';

export async function createHttpServerSource(
  name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const document: CloudSourceDocument = {
    name, protocol: 'http-api',
    config: { role: 'server', endpoint: 'http://managed', options: {} },
  };
  const saved = await client.source.documents.create({
    dryRun: false, document, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存的 Source');
  return { receipt: saved, current: saved.data };
}
```

Server 的固定前缀 `/ingest/v1/{workspaceId}/{sourceId}` 和 Bearer 要求由协议目录的 `x-tier0-http-in` 描述。Source 不接受业务路径配置；在 [Stream HTTPServer 示例](../../tier0-sdk-v2-stream/references/http-server.md)中注册 `onRequest` 的 method/path。响应时机属于 Stream。

## 四类 inline 认证与 REQUEST 绑定

单条创建可通过 `credentials` 提供以下只写材料；与已有 auth/TLS 引用互斥，并要求本次创建的 `idempotencyKey`。材料从调用方已授权的密钥提供者注入，不在示例中读取文件或环境中的秘密，不记录或返回材料。

| kind | material | method |
| --- | --- | --- |
| basic | username、password | 省略时 REQUEST；可显式绑定受限 HTTP 方法 |
| bearer | token | 省略时 REQUEST；上方 GET 示例保持明确的方法限制 |
| apiKey | headerName、value | 省略或 REQUEST |
| oauth2ClientCredentials | tokenUrl、clientId、clientSecret；可选 scope、clientAuthentication | 省略、REQUEST 或 GET |

OAuth 的 `clientAuthentication` 支持 `client_secret_post`（默认）和 `client_secret_basic`。REQUEST 表示绑定 Source 基址，实际路径和方法仍由执行宿主逐次授权；显式方法的已有绑定不能解释成 REQUEST 的基址范围。vendor SESSION 合同独立保留，不是此 inline 创建的 method，也不新增独立公开凭据 API。

```ts
import { createClient, type Tier0Client, type CloudSourceCreateCredentials } from '@tier0/sdk-v2';

export async function createHttpSourceWithCredentials(
  endpoint: string, name: string, credentials: CloudSourceCreateCredentials, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const saved = await client.source.documents.create({
    dryRun: false, idempotencyKey: intentKey,
    document: { name, protocol: 'http-api',
      config: { role: 'client', endpoint, options: {} } },
    credentials,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存的 Source');
  return { receipt: saved, current: saved.data };
}
```
