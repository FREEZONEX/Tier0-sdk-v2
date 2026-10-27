# 一致性与调用身份

## 一致性写法

- 单个文档的写入是原子的：必须一起变化的数据放在同一个文档里。
- 状态流转把期望状态写进过滤条件：`findOneAndUpdate({ _id, status: 'DRAFT' }, { $set: { status: 'RELEASED' } })`；返回 `null` 表示记录不存在或已被别人改走，回 409。
- 并发编辑：编辑表单带回 `_meta.revision`，作为 `expectedRevision` 发送；`VERSION_CONFLICT`（409）表示重新读取后再试。
- 跨文档不变量（库存 + 预留、订单 + 审计记录）：一次 `data.transact([...])`（≤200 步），用 `record.check` / `record.update` / `record.create` 步骤、`dependsOn` 与 `bindings`；`record.query` 步骤可断言 `expectCount: { min, max }`。整体全部提交或全不提交；它不是会话，不能在里面“先读再决定”。步骤的 `data` 不能含 `_id`（在步骤上设 `id`）；由 `bindings` 填充的字段在 UNS 提交时校验，其余字面量字段在发送前校验。
- 计数器与流水号：声明一个计数器集合，`findOneAndUpdate({ _id: 'work_orders' }, { $inc: { value: 1 } }, { upsert: true })`。
- upsert 的过滤条件必须含 `_id` 或某个已就绪唯一索引的全部字段，否则 `UPSERT_REQUIRES_UNIQUE_INDEX`；新声明的唯一索引是异步构建的。
- `DUPLICATE_KEY`（409）表示唯一索引拒绝了该值，按字段错误展示。

```ts
import { z } from 'zod';
import { createDataClient, defineCollection } from '@tier0/sdk-v2/data';

const stock = defineCollection({ alias: 'stock', schema: z.object({ sku: z.string(), available: z.number().int().min(0).meta({ format: 'int32' }) }) });
const reservations = defineCollection({ alias: 'reservations', schema: z.object({ sku: z.string(), qty: z.number().int().min(1).meta({ format: 'int32' }), orderId: z.string() }) });
const counters = defineCollection({ alias: 'counters', schema: z.object({ value: z.number().int().meta({ format: 'int32' }) }) });
const data = createDataClient({ collections: [stock, reservations, counters] });

/** 扣减库存并写预留：库存不足时整体不提交。 */
export async function reserve(sku: string, qty: number, orderId: string) {
  return data.transact(
    [
      { opId: 'check', action: 'record.check', collection: stock, filter: { _id: sku, available: { $gte: qty } } },
      { opId: 'take', action: 'record.update', collection: stock, id: sku, update: { $inc: { available: -qty } }, dependsOn: ['check'] },
      { opId: 'hold', action: 'record.create', collection: reservations, data: { sku, qty, orderId }, dependsOn: ['take'] },
    ],
    { idempotencyKey: `reserve-${orderId}` },
  );
}

export async function nextOrderNumber() {
  const counter = await data.collection(counters).findOneAndUpdate({ _id: 'sales_orders' }, { $inc: { value: 1 } }, { upsert: true });
  return counter?.value;
}
```

`transact` 的结果状态不是 `committed`（`dryRun` 时为 `validated`）会抛 `TRANSACTION_FAILED`，`details.results` 带每一步的错误。

## 调用身份

每次调用都使用平台注入的 App Key。处理业务请求时，数据层还会转发网关签发的员工断言（`X-Tier0-App-Data-Subject`），让 UNS 的数据规则与记录租约作用于该员工。集合 ensure 与种子写入以 App 身份执行。

App 的请求入口用 `runWithRequestContext(request, next)` 打开请求上下文（传 `Request` 本身：调用方断开时，还在排队的数据调用不再发出，进行中的被取消；只传 `request.headers` 则没有取消）；脱离请求的工作（定时器、队列、发出即不管的后续任务）放进 `runAsApp(() => ...)`，这些调用不带员工身份；员工身份下取得的租约不能由这类 App 级工作释放。断言格式由 SDK 校验（三段 base64url），格式不合法时调用在发出请求前失败。

```ts
import { currentDataSubject, runAsApp, runWithRequestContext } from '@tier0/sdk-v2/data';

export function handleRequest<T>(request: Request, next: () => Promise<T>): Promise<T> {
  return runWithRequestContext(request, next);
}

export function scheduleFollowUp(task: () => Promise<void>) {
  setTimeout(() => void runAsApp(task), 1000);
}

export function servingEmployee(): boolean {
  return currentDataSubject() !== undefined;
}
```

## 首次访问与自愈

进程内第一次数据访问会一次性 ensure 全部声明：缺失的集合会被创建（随后写入种子），更宽的声明会放宽存储，存储永远不会被收窄。ensure 失败不缓存，下一次请求会重试（刚导入的 App 可能短暂返回 `APP_NOT_READY`，数据层先自动重试，仍失败时按 503 回答）。

运行中的进程在所用集合消失时会自愈（Preview 重置会删除集合，worker 或管理员可能归档集合）：UNS 以 `data.reason` 为 `COLLECTION_NOT_FOUND` 或 `COLLECTION_NOT_GRANTED` 拒绝调用时，数据层重新 ensure（重建并重新写入种子），并在集合 ID 确实变化时把该调用重试一次。每个 client 每 30 秒最多重建一次；`APP_GRANT_REVOKED`（管理员决定）从不重试。延续旧集合游标的分页、`updateMany` / `deleteMany` 的续写直接失败，不会重试。

Preview（`environment: 'preview'`，`NODE_ENV` 不是 production 时的默认值）下，Schema 冲突或 ensure 警告会让请求失败并带上详情；部署环境只记录日志、继续服务。`ignored` 提示从不让请求失败：存储比声明更宽的部分记为 info，`ANNOTATION_NOT_APPLIED`（ensure 不会改写的描述）记为指向 `schema:replace` 的 warning。
