# 一致性与请求上下文

一个文档的写入原子。必须一起变化的有界数据放同一文档；状态流转把旧状态放进 filter，编辑表单带回 `_meta.revision` 作为 expectedRevision。

- 条件未匹配与 VERSION_CONFLICT 不同于成功更新；重读后重新决定。
- upsert 要求 _id 等值或 ready 唯一索引的全部字段等值；新唯一索引异步构建。
- 跨文档不变量用一次 data.transact，不拆成独立 HTTP 请求。超过 200 步时 SDK 读取当前 App 的 limits.transaction 并校验容量，客户端最高 10,000 步；旧服务端没有该能力字段时仍为 200。data.getTransactionLimits() 可用于业务预检，实际发送前仍重新核对大事务容量；SDK 更新本身不会部署后端能力。
- 对同一集合的完整匹配范围应用同一个更新，用 `collection.updateManyAtomic(filter, update, options)`。这是独立后端能力：一次请求、同一数据库事务，失败整批回滚，SDK 不枚举或分批。`$currentDate` 使用该数据库事务时间；返回 matchedCount、modifiedCount、transactionTime、replayed、dryRun。可选 arrayFilters、idempotencyKey、dryRun、requireIndexesReady；最后一项要求声明集合并检查当前索引。仍受服务端超时和资源预算约束；结果未知时直接抛错，不自动重发。旧 updateMany 的部分提交语义不变，目标后端须先部署此预览能力。

```ts
import { createDataClient } from '@tier0/sdk-v2/data';

const data = createDataClient({});
const stock = { collectionId: 'stock-id' };
const reservations = { collectionId: 'reservations-id' };

export async function reserve(sku: string, qty: number, orderId: string) {
  return data.transact([
    { opId: 'check', action: 'record.check', collection: stock, filter: { _id: sku, available: { $gte: qty } } },
    { opId: 'take', action: 'record.update', collection: stock, id: sku, update: { $inc: { available: -qty } }, dependsOn: ['check'] },
    { opId: 'hold', action: 'record.create', collection: reservations, id: orderId, data: { sku, qty, orderId }, dependsOn: ['take'] },
  ], { idempotencyKey: `reserve-${orderId}` });
}
```

transact 是声明式原子步骤，不是能在中间执行应用代码的数据库会话。步骤 data 不含 _id，在步骤上用 id；dependsOn/bindings 表达依赖，record.query 可用 expectCount。失败抛 TRANSACTION_FAILED 并附 details.results；dryRun 仅验证。

支持该能力的后端在成功的 record.check/read 结果中提供可选 transactionTime（数据库事务开始时间，Unix 毫秒）。后续步骤可用 `{ path: 'data.createdAt', ref: 'clock', resultPath: 'transactionTime' }` 绑定同事务时间，默认写入 number；字符串日期字段可增加 `format: 'iso8601'`，由后端把同一个数据库时间格式化为固定三位毫秒的 UTC ISO 字符串。format 只适用于 transactionTime，不改变结果里的数字值。旧后端可以省略该字段，原来不带 format 的绑定保持兼容，SDK 不以应用时钟补值；需要服务器时间或 ISO 格式的业务必须确认目标后端支持后再启用。此本地预览契约尚未随 npm 发布，SDK 更新也不部署后端。

## 调用身份与请求上下文

平台调用代表 App 自身。App 服务端负责访问者规则，见 [身份集成](../../references/integration.md)。请求入口用 runWithAbortSignal 传递取消信号；独立后台任务用 runDetached。取消已发出的写入不代表回滚。

```ts
import { runDetached, runWithAbortSignal } from '@tier0/sdk-v2/data';

export function handleRequest<T>(request: Request, next: () => Promise<T>): Promise<T> {
  return runWithAbortSignal(request.signal, next);
}
export function scheduleFollowUp(task: () => Promise<void>) {
  setTimeout(() => void runDetached(task), 1000);
}
```

ensure、种子与订阅为共享工作，不随单个请求取消。

## 首次访问与自愈

每个 client 首次访问声明集合时一次 ensure 全部声明；缺失集合创建并写种子，已有结构只放宽。失败不缓存，后续访问可重试。Preview 下冲突或警告使请求失败并带详情；部署环境记录日志，继续使用已有 ID。ignored 是提示，不等于失败。

声明集合被 COLLECTION_NOT_FOUND/COLLECTION_NOT_GRANTED 拒绝时，数据层按限频重新 ensure，只有 ID 确实变化才重试一次原调用。显式 APP_GRANT_REVOKED、OWNER_APP_TRASHED、已有集合 ID 引用不触发补建；分页游标和批量续做也不跨新集合自动重试。历史只读成功不触发自愈。
