---
name: tier0-sdk-v2-data
description: 使用 @tier0/sdk-v2/data 在 App 服务端声明并读写本 App 的 UNS 集合：Zod 建模、种子与 TTL、Mongo 风格读写、带总数分页与分组计数、原子批量与事务、变更订阅、员工数据主体、Schema 演进和错误码处理。
---

# App 数据层

工业场景创建数据前，先按[工业命名空间指导](../tier0-sdk-v2-uns/references/namespace.md)查找并复用已有 ISA-95 目录，只创建业务需要且缺失的层级。`defineCollection` / ensure 不接收 `parentId`，新集合默认放入 App 专属目录；需要指定工业目录时，由 Agent 在构建期用现有元数据接口创建并通过 `data.parentId` 放置，运行时按已有集合 ID 访问。

`@tier0/sdk-v2/data` 是 App 业务数据的服务端入口：用 `defineCollection` 声明集合，`createDataClient` 在首次访问时一次性 ensure 全部声明，然后用 Mongo 驱动风格的集合句柄读写 UNS 记录。没有 SQL、ORM、连接串或迁移步骤；Preview 与部署后的 App 共用同一批集合和记录。

这里创建的集合以 `ownerAppId` 标识唯一所属 App。使用已有或其他 App 共享的集合时，用 `data.collection({ collectionId })` 获取句柄；可选 `schema` 仅做本地写入校验，不创建或修改集合。已有 ID 引用同样用于 `queryBatch`、`transact` 和 `subscribe`，不放入 `createDataClient` 的 `collections` 声明数组，不执行 ensure 或写种子。无需服务端 alias，仍须当前 App 已有相应集合授权；SDK 不授予权限，复用不改变所属关系。底层 [UNS](../tier0-sdk-v2-uns/SKILL.md) 的记录接口仍可直接按 ID 使用。

数据读写只在服务端代码（业务 service）里用 `@tier0/sdk-v2/data`：该入口依赖 Node 内置模块，浏览器打包会直接失败。组件和 route 的客户端代码只能从 `@tier0/sdk-v2/data/define` 取集合声明和类型（`defineCollection`、`Doc`、`NewDoc` 等），它不加载数据运行时，可以进浏览器包。需要 `zod` 4。底层调用 SDK 生成的 UNS 操作（`appCollectionsEnsure`、`recordFind`、`recordTransactionExecute` 等），凭证读取平台注入的 TIER0_API_HOST / TIER0_API_KEY。

集合声明必须分别填写业务名称 `name` 与稳定程序标识 `alias`，例如 `name: '生产工单'`、`alias: 'production_orders'`。name 是唯一界面名称，没有 displayName 或 alias 回退；ensure 通过 alias 找回原集合，不覆盖用户改名。

## 按任务加载参考

| 用户任务 | 参考 |
| --- | --- |
| 声明集合、选字段类型、索引、种子数据、文档建模 | [建模](references/modeling.md) |
| 查询、按 ID 读取、一页一次请求（queryBatch）、分页、聚合、写入、批量与原子性、订阅变更 | [读写](references/read-write.md) |
| 状态流转、并发编辑、跨文档不变量、计数器、员工身份与后台任务 | [一致性与身份](references/consistency.md) |
| 加字段、改类型、改描述、收窄 Schema | [Schema 演进](references/schema-evolution.md) |
| DataError 字段、UNS 错误码与处理 | [错误码](references/errors.md) |

## 最小用法

新 App 没有集合时是正常空态：`uns.dataAppContext({})` 返回 `dataState: "uninitialized"` 和空集合，不创建任何数据。无需先调用 context 或手工激活数据策略；声明真实业务集合后，第一次数据访问会自动初始化。`dataState: "ready"` 也不代表可访问整个工作空间，仍以返回的集合授权为准。引用已有 WMS 等集合需要明确共享授权，不能创建同名空集合代替。管理员停用返回 `FORBIDDEN`、reason `APP_DATA_POLICY_DISABLED`，不得自动恢复。

```ts
import { z } from 'zod';
import { createDataClient } from '@tier0/sdk-v2/data';
import { defineCollection, type Doc } from '@tier0/sdk-v2/data/define';

export const workOrders = defineCollection({
  alias: 'work_orders',
  name: '生产工单',
  description: 'Production work orders',
  schema: z.object({
    code: z.string(),
    status: z.enum(['DRAFT', 'RELEASED', 'DONE', 'CANCELLED']),
    targetQty: z.number().int().min(1).meta({ format: 'int32' }),
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

1. 声明文件只从 `@tier0/sdk-v2/data/define` 导入，客户端代码可以安全引用它；由 ensure 管理的自有集合放在一个 `collections` 列表里（每个 App 最多 64 个），只建一个进程级 client；不要手动 ensure、不要在 import 时访问数据、不要自建“已初始化”标记。
2. 集合 Schema 是存储 Schema：只能用可存储的 Zod 子集，输入规则（格式、长度、默认值、transform）放在 API 入参 Schema。
   新建数值字段明确选择 int（integer + int32）、float 或 double（number + 对应 format）；普通小数选 double，嵌套对象和数组元素同样处理。SDK 会为未标注的 integer/number 补齐 int32/double；直接 MCP 请求必须自行提供 format。
3. 写入前按声明严格校验，未知字段、类型错误、未声明的更新路径直接抛 `ZodError`；读取不做严格解析，旧版本写入的字段、新枚举值或缺字段都可能出现。
4. `insertMany` / `bulkWrite` / `transact` 每次最多 200 项且原子；`updateMany` / `deleteMany` 逐条提交、非原子。
5. 按 `DataError.code` 与 `reason`（`data.reason`）分支，不匹配 message 文本；`status` 是 App 应回给自己调用方的 HTTP 状态。
6. `schema:replace`、`archive`、`restore` 是 worker 通过 tier0 MCP 的显式操作，不在运行时代码里调用。
7. 调用策略由数据层负责：每次调用从开始算最多 25 秒（排队、重试都算在内），每进程最多 6 个并发数据请求（其余排队，超时或业务请求中止时不再发出），UNS 标记 `retry.safe` 的失败（过载 429、暂时不可用 503、已回滚的写入冲突等）按 `retry.afterMs` 自动重试最多 2 次。每次写入调用自动带一个新的幂等键并在重试中复用，不需要手写；只有“同一业务意图跨多次调用只生效一次”（如按订单号预留库存）才显式传 `idempotencyKey`。不要在外面再包一层重试循环。
