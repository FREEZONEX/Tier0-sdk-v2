---
name: tier0-sdk-v2-data
description: 使用 @tier0/sdk-v2/data 在 App 服务端声明并读写本 App 的 UNS 集合：Zod 建模、种子与 TTL、Mongo 风格读写、带总数分页与分组计数、原子批量与事务、变更订阅、员工数据主体、Schema 演进和错误码处理。
---

# App 数据层

`@tier0/sdk-v2/data` 是 App 自有业务数据的服务端入口：用 `defineCollection` 声明集合，`createDataClient` 在首次访问时一次性 ensure 全部声明，然后用 Mongo 驱动风格的集合句柄读写 UNS 记录。没有 SQL、ORM、连接串或迁移步骤；Preview 与部署后的 App 共用同一批集合和记录。

数据读写只在服务端代码（业务 service）里用 `@tier0/sdk-v2/data`：该入口依赖 Node 内置模块，浏览器打包会直接失败。组件和 route 的客户端代码只能从 `@tier0/sdk-v2/data/define` 取集合声明和类型（`defineCollection`、`Doc`、`NewDoc` 等），它不加载数据运行时，可以进浏览器包。需要 `zod` 4。底层调用 SDK 生成的 UNS 操作（`appCollectionsEnsure`、`recordFind`、`recordTransactionExecute` 等），凭证读取平台注入的 TIER0_API_HOST / TIER0_API_KEY。

## 按任务加载参考

| 用户任务 | 参考 |
| --- | --- |
| 声明集合、选字段类型、索引、种子数据、文档建模 | [建模](references/modeling.md) |
| 查询、分页、聚合、写入、批量与原子性、订阅变更 | [读写](references/read-write.md) |
| 状态流转、并发编辑、跨文档不变量、计数器、员工身份与后台任务 | [一致性与身份](references/consistency.md) |
| 加字段、改类型、改描述、收窄 Schema | [Schema 演进](references/schema-evolution.md) |
| DataError 字段、UNS 错误码与处理 | [错误码](references/errors.md) |

## 最小用法

```ts
import { z } from 'zod';
import { createDataClient } from '@tier0/sdk-v2/data';
import { defineCollection, type Doc } from '@tier0/sdk-v2/data/define';

export const workOrders = defineCollection({
  alias: 'work_orders',
  description: 'Production work orders',
  schema: z.object({
    code: z.string(),
    status: z.enum(['DRAFT', 'RELEASED', 'DONE', 'CANCELLED']),
    targetQty: z.number().int().min(1),
    dueAt: z.string(),
  }),
  indexes: [{ path: 'code', unique: true }, { path: 'status' }],
});
export type WorkOrder = Doc<typeof workOrders>;

// 每个服务端进程一个 client：ensure 结果按 client 缓存。
export const data = createDataClient({ collections: [workOrders] });

export async function releasedOrders(): Promise<WorkOrder[]> {
  return data.collection(workOrders).find({ status: 'RELEASED' }, { sort: { '_meta.createdAt': -1 }, limit: 50 }).toArray();
}
```

## 核心约束

1. 声明文件只从 `@tier0/sdk-v2/data/define` 导入，客户端代码可以安全引用它；全部集合在一个 `collections` 列表里声明（每个 App 最多 64 个），只建一个进程级 client；不要手动 ensure、不要在 import 时访问数据、不要自建“已初始化”标记。
2. 集合 Schema 是存储 Schema：只能用可存储的 Zod 子集，输入规则（格式、长度、默认值、transform）放在 API 入参 Schema。
3. 写入前按声明严格校验，未知字段、类型错误、未声明的更新路径直接抛 `ZodError`；读取不做严格解析，旧版本写入的字段、新枚举值或缺字段都可能出现。
4. `insertMany` / `bulkWrite` / `transact` 每次最多 200 项且原子；`updateMany` / `deleteMany` 逐条提交、非原子。
5. 按 `DataError.code` 与 `reason`（`data.reason`）分支，不匹配 message 文本；`status` 是 App 应回给自己调用方的 HTTP 状态。
6. `schema:replace`、`archive`、`restore` 是 worker 通过 tier0 MCP 的显式操作，不在运行时代码里调用。
7. 调用策略由数据层负责：每次调用从开始算最多 25 秒（排队、重试都算在内），每进程最多 6 个并发数据请求（其余排队，超时或业务请求中止时不再发出），UNS 标记 `retry.safe` 的失败（过载 429、暂时不可用 503、已回滚的写入冲突等）按 `retry.afterMs` 自动重试最多 2 次。每次写入调用自动带一个新的幂等键并在重试中复用，不需要手写；只有“同一业务意图跨多次调用只生效一次”（如按订单号预留库存）才显式传 `idempotencyKey`。不要在外面再包一层重试循环。
