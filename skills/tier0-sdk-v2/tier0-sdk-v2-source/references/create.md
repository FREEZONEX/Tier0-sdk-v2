# 创建 Source

方法：`source.documents.create`；POST `/openapi/v2/uns/sources/documents/create`。需要 Source manage 权限。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 否 | 默认 false 提交；true 仅预检 |
| document.name | string | 是 | 1–128 字符 |
| document.protocol | string | 是 | 原生协议，如 http-api、mqtt、modbus |
| document.config.role | client / server | HTTP API 显式指定 | client 主动请求；server 接收入站请求 |
| document.config | object | 是 | endpoint、options；见[协议配置](protocols.md) |
| document.description | string | 否 | 最多 512 字符 |
| credentials | object | 否 | HTTP Client 或 SQL 的只写新凭据；与已有 auth 引用互斥 |
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

Source 保存 API 基址和认证；实际请求的 method/path/query 由 Stream 设置。例如 endpoint 使用 `https://inventory.example.com/api/v1`，再由 [Stream 示例](../../tier0-sdk-v2-stream/references/create.md)请求 `GET inventory`。token 从服务端密钥提供者取得，不写入脚本、文档、日志或仓库。

普通创建省略 `credentials.method`，服务端按 `REQUEST` 绑定 Source 基址。REQUEST 是凭据适用范围标记，不是发送给上游的 HTTP 方法；实际 GET 请求仍由执行宿主逐次授权。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createAuthenticatedHttpSource(
  endpoint: string, name: string, token: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const saved = await client.source.documents.create({
    dryRun: false, idempotencyKey: intentKey,
    document: { name, protocol: 'http-api', config: { role: 'client', endpoint, options: {} } },
    credentials: { kind: 'bearer', material: { token } },
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

HTTP Client 单条创建可通过 `credentials` 提供以下只写材料；与已有 auth 引用互斥，HTTP/SQL 当前不支持 TLS 凭据引用，并要求本次创建的 `idempotencyKey`。材料从调用方已授权的密钥提供者注入，不在示例中读取文件或环境中的秘密，不记录或返回材料。

| kind | material | method |
| --- | --- | --- |
| basic | username、password | 省略时 REQUEST；显式方法绑定精确 URL 和该方法 |
| bearer | token | 省略时 REQUEST；显式方法绑定精确 URL 和该方法 |
| apiKey | headerName、value | 省略或 REQUEST |
| oauth2ClientCredentials | tokenUrl、clientId、clientSecret；可选 scope、clientAuthentication | 普通创建省略；旧 GET 保留既有兼容语义 |

Basic/Bearer 显式 `credentials.method: 'GET'` 表示凭据只用于所绑定精确 URL 的 GET，不表示该基址下所有 GET 都可使用：绑定 `/api/v1` 不授权 `/api/v1/inventory?limit=5000`。仅在任务明确需要该限制时传入；已有绑定保持原限制，不自动迁移或在拒绝后回退 REQUEST。

OAuth 的 `clientAuthentication` 支持 `client_secret_post`（默认）和 `client_secret_basic`；method 接受省略、REQUEST 或旧 GET，旧 GET 保留现有兼容语义，不能把 Basic/Bearer 的精确 URL 规则跨认证类型套用。普通创建仍省略 method。vendor SESSION 合同独立保留，不是此 inline 创建的 method，也不新增独立公开凭据 API。

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

## SQL 用户名和密码

SQL 单条创建可直接传入 `credentials: { kind: "usernamePassword", material: { username, password } }`，不再预先调用独立凭据接口。`document.protocol` 为 `sql`，`config.endpoint` 只包含数据库地址（不包含用户名或密码），`credentials.method` 必须省略。仍需 `idempotencyKey`。秘密由 Vault 保存，Source 文档仅含引用；预检不写入凭据。

`dryRun` 省略时直接提交；需要预检才设为 true。后续启用 Source、部署 Stream，并通过运行记录和 Collection 读回确认采集成功。
