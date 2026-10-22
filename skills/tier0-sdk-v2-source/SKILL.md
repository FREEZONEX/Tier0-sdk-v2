---
name: tier0-sdk-v2-source
description: 使用 @tier0/sdk-v2 的 client.source 管理 Tier0 数据源、原生连接文档、协议发现、运行观测和修改影响分析。适用于 HTTP、MQTT 等外部系统接入配置。
---

# Source 数据接入

Source 负责连接配置、认证引用和源状态。处理脚本/发布用 [Stream](../tier0-sdk-v2-stream/SKILL.md)，存储数据用 [UNS](../tier0-sdk-v2-uns/SKILL.md)。使用服务端 `createClient({ apiHost, apiKey })`，或注入 `TIER0_API_HOST` / `TIER0_API_KEY`。

## 选对文档形态

| 任务 | 调用 |
| --- | --- |
| 原生源安全摘要、原生编辑器文档 | `source.documents.list/get` |
| 原生文档新增与更新 | `source.documents.create/update` |
| 通用投影列表/详情、创建/更新 | `source.list/get/create/update` |
| 协议能力与配置校验 | `source.protocols.list`、`source.validate` |
| 连接、启停、删除 | `source.connection.update`、`source.state.update`、`source.delete` |
| 修改影响、历史 | `source.impact`、`source.history` |
| 运行状态、批量观测、探测 | `source.runtime.get`、`source.observations.get`、`source.probe` |

原生文档是 `{ name, protocol, config }`，如 HTTP 的 protocol 为 `http`；通用投影的 adapter 为 `http-api`。不要互换这两个值，也不要把不能转换的原生源重建成匿名 HTTP 源。原生 ID 是十进制字符串，保留服务端原值。

## 读取已有数据源

```ts
import { createClient } from '@tier0/sdk-v2';

export async function inspectSources() {
  const client = createClient();
  const response = await client.source.documents.list({
    page: 1, size: 20, includeDocument: false,
  });
  return { requestId: response.requestId, data: response.data };
}
export async function inspectSource(id: string) {
  const client = createClient();
  return client.source.documents.get({ id });
}
```

`includeDocument: false` 适合浏览者；完整文档需要 Source manage 权限。App 数据 Key 不自动具有 Source 管理权限。不要把列表里的安全摘要当作可无损回写的完整配置。

## 新建与校验

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type SourceDocument = Parameters<Tier0Client['source']['documents']['create']>[0]['document'];
export async function previewNewSource(document: SourceDocument) {
  const client = createClient();
  return client.source.documents.create({ dryRun: true, document });
}
```

先发现协议要求，再由真实连接参数构建完整文档。预览确认有效后，按已授权的创建意图显式提交 `dryRun: false`。需要 HTTP 新凭据时，使用创建请求专用的 `credentials` 字段；不要把秘密塞进文档、日志或 Stream script。现有认证/TLS 引用要保留原值。

## 更新已有源的正确流程

1. 读取完整文档和当前 revision，形成精确的新文档或启停/删除意图。
2. 调用 `source.impact({ id, expectedRevision, action, ... })`；update 时提供拟提交的文档。
3. 阅读 draft、activeRelease、historicalRelease 影响计数，以及受权限限制的 `restrictedCount`。引用列表按 `nextOffset` 分页，后续请求保持同一意图和返回的 `impactRevision`。
4. 在对应变更请求中同时携带原 `expectedRevision` 和 `confirmedImpactRevision`。这个值是服务端签发的精确意图凭据，不能自行拼造，也不能改完文档后继续使用旧值。
5. 出现 revision 冲突、确认过期或意图不一致时，重新读取和评估；不要在后台悄悄刷新确认值并重复修改。

[影响分析示例](references/changes.md)展示如何准备变更。影响确认不能替代已有的操作授权；读状态的请求不意味着允许启停或删除源。

## 运行观测与结果处理

Source/Stream/UNS 均返回完整响应，业务结果在 `response.data`。配置写入成功不等于连接已健康；结合 `runtime.get` 与带 expectedRevision 的 `observations.get` 判断。探测可能触达外部系统，`dryRun: true` 的校验不能当成实际连通性证据。

写入出现 `UnsV2OutcomeUnknownError` 时保存 requestId、原请求与意图键，查询详情/历史核对；SDK 不自动重试。多项写入只有显式 `allowPartial: true` 才按项提交，必须检查每项错误；delete 的当前契约不支持部分提交。
