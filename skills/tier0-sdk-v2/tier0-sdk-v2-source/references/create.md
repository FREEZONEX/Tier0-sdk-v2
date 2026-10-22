# 创建 Source

方法：`source.documents.create`；POST `/openapi/v2/uns/sources/documents/create`。需要 Source manage 权限。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 是 | true 校验；false 保存 |
| document.name | string | 是 | 1–128 字符 |
| document.protocol | string | 是 | 原生协议，如 http、mqtt、modbus |
| document.config | object | 是 | configVersion=2、endpoint、options；见[协议配置](protocols.md) |
| document.description | string | 否 | 最多 512 字符 |
| credentials | object | 否 | 仅创建时提供新 HTTP 凭据，与已有 auth/TLS 引用互斥 |
| idempotencyKey | string | 否 | 建议提供，最多 128 字符，同一业务意图保持不变 |

## 完整示例：HTTP 数据源

传入实际端点、名称和意图键。此函数创建配置，不启用源。client 从服务端环境读取 API Host/Key，也可显式注入。

```ts
import { createClient, type Tier0Client, type CloudSourceDocument } from '@tier0/sdk-v2';

export async function createHttpSource(
  endpoint: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const document: CloudSourceDocument = {
    name, protocol: 'http', description: '订单系统 HTTP 接入',
    config: { configVersion: 2, endpoint, options: {} },
  };
  const preview = await client.source.documents.create({ dryRun: true, document });
  if (!('validated' in preview.data) || !preview.data.validated) throw new Error('Source 预检未通过');
  const saved = await client.source.documents.create({
    dryRun: false, document, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存的 Source');
  const current = await client.source.documents.get({ id: saved.data.id });
  return { receipt: saved, current: current.data };
}
```

提交返回 data：id、revision、document、desiredState、runtimeState、health、createdAt、updatedAt；预检返回 `{ validated: true, sideEffects: false }`，没有 ID。ID 原样保留十进制字符串。

## HTTP Bearer 凭据

token 从服务端密钥提供者取得，不写入脚本、文档、日志或仓库。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createAuthenticatedHttpSource(
  endpoint: string, name: string, token: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const saved = await client.source.documents.create({
    dryRun: false, idempotencyKey: intentKey,
    document: { name, protocol: 'http', config: { configVersion: 2, endpoint, options: {} } },
    credentials: { method: 'GET', kind: 'bearer', material: { token } },
  });
  if (!('id' in saved.data)) throw new Error('未返回 Source ID');
  return client.source.documents.get({ id: saved.data.id });
}
```

配置保存不代表连接健康；见[查询](read.md)。仅在任务包含启用时执行[启停](state.md)。结果未知时保留原请求、requestId、意图键，先核对列表/历史，不自动重复创建。
