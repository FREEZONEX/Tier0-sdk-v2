---
name: tier0-sdk-v2-uns
description: 使用 @tier0/sdk-v2 的 client.uns 开发 Tier0 集合、目录、Topic、Record CRUD、采样历史、事务与 App 数据访问；Source 接入和 Stream 运行使用独立领域入口。
---

# UNS 数据操作

UNS 管数据命名空间和存储。使用服务端 `createClient()` 读取注入的 API Host/Key；Source、Stream 已拆分，不再从 `client.uns` 调用。SDK 提供的方法不等于 App Key 有管理权限。

## 从数据上下文开始

```ts
import { createClient } from '@tier0/sdk-v2';

export async function findOrdersByAlias(alias: string) {
  const client = createClient();
  const context = await client.uns.dataAppContext({});
  const collection = context.data.collections.find(item => item.alias === alias);
  if (!collection) throw new Error('当前 App 未获得该集合授权');
  const description = await client.uns.collectionDescribe({ collectionId: collection.collectionId });
  const page = await client.uns.recordFind({ collectionId: collection.collectionId, limit: 20 });
  return { schema: description.data, records: page.data.items, pageInfo: page.data.pageInfo };
}
```

`dataAppContext` 只适用于已认证的托管 App。Workspace 集成可用 `dataDiscover({ search, page, size })`、`collectionDescribe` 找集合；不要给 Workspace Key 强制调用 App 上下文。别把集合名称或 alias 当 collectionId，也不要取上下文第一个集合来猜业务目标。

## 按业务选择方法

| 任务 | 方法 |
| --- | --- |
| 发现与结构 | `dataDiscover`、`collectionDescribe`、`catalog` |
| 目录、Topic、集合管理 | `directoryList/Get/…`、`topicList/Get/…`、`collectionList/Get/…` |
| 查询、计数、去重与聚合 | `recordFind`、`recordCount`、`recordDistinct`、`recordAggregatePipeline` |
| 增、改、替换、删 | `recordInsertOne/Many`、`recordUpdateOne/Many`、`recordReplaceOne`、`recordDeleteOne/Many` |
| 多步骤一致性 | `recordTransactionExecute`；`recordBulkWrite` 不应被臆断成跨集合事务 |
| 采样写入与历史 | `sampleAppend`、`sampleFind`、`sampleAggregate`、`sampleLatestValues` |
| 变更订阅 | `recordChangesPoll` |
| 租约/恢复 | `recordLock/Renew/Unlock`、`recordRestore` |

## 写入与并发

```ts
import { createClient } from '@tier0/sdk-v2';

export async function previewRename(collectionId: string, recordId: string, name: string) {
  const client = createClient();
  const found = await client.uns.recordFind({ collectionId, filter: { _id: recordId }, limit: 1 });
  const current = found.data.items[0];
  if (!current) throw new Error('记录不存在或不可见');
  return client.uns.recordUpdateOne({
    collectionId, filter: { _id: recordId }, expectedRevision: current.revision,
    dryRun: true, update: { $set: { name } },
  });
}
```

实际提交使用经业务确认的内容、`dryRun: false` 和稳定的 idempotencyKey；预览不锁定资源，提交前发生版本冲突需重新读取并决策。普通 Record 写入的意图键最多 96 字符，不套用 Source 的 128 字符限制。

响应行是 `{ id, data, revision, … }`，但 filter/update 的业务字段使用 `name`、`customer.name`，不是 `data.name`；系统字段使用 `_id`、`_meta.revision`。sort 是 `[['field', 1]]` 形式，不能直接照搬 MongoDB 的 sort 对象。字段需符合实际集合 Schema。

## 分页、采样与精度

`recordFind` 返回 `data.items` 和 `data.pageInfo`，按 hasMore/nextCursor 继续；limit 范围 1–200。不要把单页当全部数据，也不要声称跨页是稳定数据库快照。完整分页与采样代码见 [数据工作流](references/data-workflows.md)。

采样时间为 Unix 毫秒，范围为 `[from, to)`；recordIds 最多 20 个。通用整数可能为 bigint，任意 JSON 的精确小数可能为 UnsV2RawNumber；不要经 Number 或普通 JSON.stringify 做无损往返。

## 错误处理

响应保留 code/msg/requestId/data。记录 `UnsV2Error` 的 code、requestId、retryAdvice 和 rolledBack；不要将受影响数据或凭证写入通用日志。retryAdvice 是服务端建议，不是 SDK 已重试的证明。

`UnsV2OutcomeUnknownError` 表示写入可能已执行，应先读取记录或通过 `jobs({ queries: […] })` 对账。调用第二参数 `{ signal }` 只取消客户端等待。事务与 allowPartial 的语义不同，不能通过补发未确认的写请求来“修复”结果。
