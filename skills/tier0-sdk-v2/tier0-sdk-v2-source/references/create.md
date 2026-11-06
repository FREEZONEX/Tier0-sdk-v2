# 创建 Source

方法：`source.documents.create`；POST `/openapi/v2/uns/sources/documents/create`。需要 Source manage 权限。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 否 | 默认 false 提交；true 仅预检 |
| document.name | string | 是 | 1–63 个 Unicode 字符 |
| document.protocol | string | 是 | 原生协议，如 http-api、oauth2、mqtt、modbus-tcp、edge-sql |
| document.role | client / server | HTTP API 显式指定 | client 主动请求；server 接收入站请求 |
| document.endpoint | string | 是 | 无凭据的协议地址 |
| document.http/sql/mqtt/modbus | object | 按协议 | 见[协议配置](protocols.md) |
| document.description | string | 否 | 最多 512 字符 |
| credentials | object | 否 | HTTP Client 或 SQL 的只写新凭据；与已有 credentialRef 引用互斥 |
| idempotencyKey | string | 否 | 建议提供，最多 128 字符，同一业务意图保持不变 |

## 完整示例：HTTP Client 数据源

传入实际端点、名称和意图键。此函数创建 `http-api` + `role: client` 配置，创建后即可供 Stream 使用。client 从服务端环境读取 API Host/Key，也可显式注入。

```ts
import { createClient, type Tier0Client, type SourceDefinition } from '@tier0/sdk-v2';

export async function createHttpSource(
  endpoint: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const document: SourceDefinition = {
    name, protocol: 'http-api', description: '订单系统 HTTP 接入',
    role: 'client', endpoint, http: { anonymous: true },
  };
  const saved = await client.source.documents.create({
    dryRun: false, document, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存的 Source');
  return { receipt: saved, current: saved.data };
}
```

一次提交即可返回完整 data：id、revision、document、runtimeState、health、createdAt、updatedAt，无需另行 get。需要单独预检时可先传 `dryRun: true`，返回 `{ validated: true, sideEffects: false }`，没有 ID。预检不保留提交条件；实际保存仍会校验。ID 原样保留十进制字符串。

HTTP Server 同样使用 `protocol: http-api`，角色为 `role: server`；其配置以 `source.protocols.list({})` 返回的正式合同为准，不能复用下方 Client 的主动请求示例。入站业务统一绑定 HTTPServer Source，路由和响应时机在 Stream 定义；202 状态不能据此报告 Stream 执行完成。

## HTTP Client Bearer 凭据

Source 保存 API 基址和认证；实际请求的 method/path/query 由 Stream 设置。例如 endpoint 使用 `https://inventory.example.com/api/v1`，再由 [Stream 示例](../../tier0-sdk-v2-stream/references/create.md)请求 `GET inventory`。token 从服务端密钥提供者取得，不写入脚本、文档、日志或仓库。

凭据使用 `{kind:"bearer",secret:token}`；不再使用 material 或 method。认证类型在 document.http.authentication 声明，实际 HTTP method/path/query 仍在 Stream 中设置。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createAuthenticatedHttpSource(
  endpoint: string, name: string, token: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const saved = await client.source.documents.create({
    dryRun: false, idempotencyKey: intentKey,
    document: { name, protocol: 'http-api', role: 'client', endpoint, http: { authentication: 'bearer' } },
    credentials: { kind: 'bearer', secret: token },
  });
  if (!('id' in saved.data)) throw new Error('未返回 Source ID');
  return { receipt: saved, current: saved.data };
}
```

配置保存不代表连接健康；见[查询](read.md)。Source 无需额外启用。结果未知时保留原请求、requestId、意图键，先核对列表/历史，不自动重复创建。

## HTTP Server：管理配置

正式协议目录规定 Server 的 `endpoint` 为 `http://managed`，不携带 Client 认证 或创建专用 `credentials`。该函数只保存 Source，不创建 Stream，也不发起入站请求。

```ts
import { createClient, type Tier0Client, type SourceDefinition } from '@tier0/sdk-v2';

export async function createHttpServerSource(
  name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const document: SourceDefinition = {
    name, protocol: 'http-api',
    role: 'server', endpoint: 'http://managed',
  };
  const saved = await client.source.documents.create({
    dryRun: false, document, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存的 Source');
  return { receipt: saved, current: saved.data };
}
```

Server 的固定前缀 `/ingest/v1/{workspaceId}/{sourceId}` 和 Bearer 要求由协议目录的 `x-tier0-http-in` 描述。Source 不接受业务路径配置；在 [Stream HTTPServer 示例](../../tier0-sdk-v2-stream/references/http-server.md)中注册 `onRequest` 的 method/path。响应时机属于 Stream。

## 原生只写凭据

Cloud 与 Enterprise 使用相同 SourceDefinition / SourceCredentials。HTTP Basic 为 `{kind:'basic',username,secret}`，Bearer 为 `{kind:'bearer',secret}`，OAuth 为 `{kind:'oauth2',secret}`；OAuth 的 tokenUrl/clientId/grantType/clientAuthentication 留在 document.http.oauth，Source protocol 使用 oauth2。custom 使用 values 字符串映射，键名按目标协议目录声明，不凭空推测。创建凭据需要 idempotencyKey 与凭据管理权限，不能把秘密写入 endpoint、脚本或日志。

```ts
import { createClient, type Tier0Client, type SourceCredentials, type SourceDefinition } from '@tier0/sdk-v2';

export async function createHttpSourceWithCredentials(
  document: SourceDefinition, credentials: SourceCredentials, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const saved = await client.source.documents.create({
    dryRun: false, idempotencyKey: intentKey,
    document, credentials,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存的 Source');
  return { receipt: saved, current: saved.data };
}
```

## SQL 用户名和密码

SQL 使用 protocol=edge-sql、顶层 endpoint 和 sql（固定命名查询）。凭据为 `{kind:'basic',username,secret}`，不传 method/material。查询和 TLS 选项以目标协议目录为准，不允许脚本传任意 SQL。

已有 Source 换证使用 `source.documents.credentials.update({id,expectedRevision,credentials,dryRun:false,idempotencyKey})`，路由 `/openapi/v2/uns/sources/documents/credentials/update`，不再调用独立 credentials.create。远端 Edge 秘密须在目标 Edge 本地预配；云绑定只使用已批准的 target，不经云转发 Edge 秘密。

dryRun 省略时直接提交。创建或换证成功不等于采集成功；仍须检查 Stream 运行与 Collection 数据。
