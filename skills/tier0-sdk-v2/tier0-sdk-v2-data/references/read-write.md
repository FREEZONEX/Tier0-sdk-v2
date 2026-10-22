# 读写

`data.collection(declaration)` 返回按声明推断类型的句柄（也可用 alias 字符串，类型由调用方指定）。读到的记录是扁平文档 `{ _id, ...字段, _meta }`；过滤、排序、投影都用同样的路径（`status`、`customer.id`、`_id`、`_meta.updatedAt`），不加 `data.` 前缀。

```ts
import { z } from 'zod';
import { createDataClient, defineCollection } from '@tier0/sdk-v2/data';

const workOrders = defineCollection({
  alias: 'work_orders',
  schema: z.object({
    code: z.string(),
    status: z.enum(['DRAFT', 'RELEASED', 'DONE']),
    line: z.object({ id: z.string(), name: z.string() }),
    targetQty: z.number().int().min(1),
    notes: z.string().optional(),
  }),
  indexes: [{ path: 'code', unique: true }, { path: 'status' }],
});
const data = createDataClient({ collections: [workOrders] });
const orders = data.collection(workOrders);

export async function dashboard(page: number) {
  const recent = await orders.find({ status: { $in: ['RELEASED', 'DONE'] } }, { sort: { '_meta.createdAt': -1 }, limit: 50 }).toArray();
  // 一页 + 总数是一次请求；total.capped 为 true 时显示成 "10000+"。
  const listPage = await orders.findPage({ status: 'RELEASED' }, { sort: { code: 1 }, page, pageSize: 20 });
  // 每个状态的数量：一次 $group，不要按状态逐个 countDocuments。
  const byStatus = await orders.countBy('status');
  const totals = await orders
    .aggregate<{ _id: string; total: number }>([{ $match: { status: 'DONE' } }, { $group: { _id: '$line.id', total: { $sum: '$targetQty' } } }])
    .toArray();
  return { recent, listPage, byStatus, totals };
}

/** 角标只需要知道“有没有超过 99 条”。 */
export async function releasedBadge() {
  const { count, capped } = await orders.countDocuments({ status: 'RELEASED' }, { maxCount: 99 });
  return capped ? '99+' : String(count);
}

export async function addNote(id: string, notes: string, revision: number) {
  return orders.updateOne({ _id: id }, { $set: { notes } }, { expectedRevision: revision });
}
```

## 方法

| 读取 | 说明 |
| --- | --- |
| `find(filter, { sort, limit, projection })` | 游标，每页最多 200 条；列表读取始终给 `limit` |
| `findOne(filter)` | 无匹配返回 `null` |
| `findPage(filter, { sort, page, pageSize, maxCount })` | 页码分页，一次请求返回 `{ items, total: { count, capped }, page, pageSize }`；pageSize 最多 200，总数默认数到 10000（`maxCount` 最多 100000），超过时 `capped: true` |
| `countDocuments(filter, { maxCount })` | 返回 `{ count, capped }`，默认数到 100000；只要阈值时给小的 `maxCount`（如角标 `99+`） |
| `countBy(field, filter)` | 每个取值的数量 `[{ value, count }]`，从多到少；一次 `$group` |
| `distinct(field, filter)` | 会取完所有页 |
| `aggregate(pipeline)` | `$match` `$sort` `$group` `$project` `$set` `$unwind` `$skip` `$limit` `$count` `$lookup`；`$lookup.from` 写声明或 alias，数据层换成集合 ID。`$exists` / `$distinct` / `$frequencies` 阶段不执行，改用 `countBy`、`distinct` 或 `$group` |

| 写入 | 说明 |
| --- | --- |
| `insertOne(doc)`、`insertMany(docs)` | 可带 `_id`；`insertMany` 最多 200 条、原子 |
| `updateOne` / `updateMany` / `replaceOne` | 更新用操作符（`$set` `$inc` `$push` `$unset`…）；`replaceOne` 会丢掉其他代码版本写入的字段 |
| `deleteOne` / `deleteMany` | 软删除，App Key 需要 `uns.delete` |
| `findOneAndUpdate` / `findOneAndReplace` / `findOneAndDelete` | 原子读改写，默认返回更新后的文档 |
| `bulkWrite(ops)` | `insertOne` / `updateOne` / `replaceOne` / `deleteOne` 混合，最多 200 项、原子 |
| `data.transact(steps)` | 跨集合原子写，见 [一致性](consistency.md) |

## 批量与原子性

| 调用 | 上限 | 原子 |
| --- | --- | --- |
| `insertMany`、`bulkWrite`、`data.transact` | 每次 ≤200 项，超过在发送前抛 `BATCH_LIMIT_EXCEEDED` | 是，全部或全不 |
| `updateMany`、`deleteMany` | 无上限，翻页处理所有匹配 | 否，逐条提交；已有提交后失败时错误保留原 `code`，`execution: 'committed'`、`retry.safe: false`，`details` 是累计结果（`matchedCount` 等、`status: 'partiallyCommitted'`、续做位置 `resumeAfter`） |

超过 200 条按 200 分块写入（循环分块即可），每块用固定 `_id` 或独立 `idempotencyKey`，重试不会重复。多条文档必须一起成功或失败时，用一次 `data.transact`（≤200 步），不要用 `updateMany`。不要在循环里逐条调用数据层：读用一次 `$in`，写用 `insertMany` / `updateMany` / `bulkWrite` 或 `data.transact`。

### 非原子批量中途失败

`updateMany` / `deleteMany` 已经提交了一部分后失败时（`execution === 'committed'`），不要整体重做：`$inc`、`$push` 这类更新会把已提交的记录再改一次。把 `details.resumeAfter` 传回去，从失败处继续：

```ts
import { DataError, type Collection } from '@tier0/sdk-v2/data';

export async function bumpAll(items: Collection<{ status: string; views: number }>) {
  let resumeAfter: string | undefined;
  for (let round = 0; round < 3; round += 1) {
    try {
      return await items.updateMany({ status: 'OPEN' }, { $inc: { views: 1 } }, { resumeAfter });
    } catch (error) {
      // 只续做已证明部分提交、且给了续做位置的失败；结局未知的那一页要先核对。
      const next = error instanceof DataError && error.execution === 'committed' ? error.details.resumeAfter : undefined;
      if (typeof next !== 'string') throw error;
      resumeAfter = next;
    }
  }
  throw new Error('updateMany kept failing');
}
```

`execution === 'unknown'` 时失败的那一页可能已经部分生效，续做前先核对。

## 过滤

支持 `$eq $ne $gt $gte $lt $lte $in $nin $exists $all $size $elemMatch $not $and $or $nor` 和 `$contains`。`$contains` 是子串匹配（1–256 字节，无通配符和正则），只对 ASCII 字母忽略大小写；缺失、null、非字符串值不匹配；只能用于声明为字符串的字段，用在数组或数字字段上返回 `INVALID_REQUEST`。它不能使用索引，大集合上可能触发 10 秒执行超时（`QUERY_TIMEOUT`），要和有索引的条件一起用。`$in` 最多 200 个值，排序最多 4 个字段（`toSortPairs` 也导出给自定义查询转换使用）。

## 校验

写入前按声明严格校验：未知字段、类型错误、未声明的更新路径抛 `ZodError`（HTTP 400 语义）。读取不严格解析：记录可能含其他代码版本写入的字段、新的枚举值，或缺少后来新增的字段。枚举渲染要有兜底标签，后加的字段按可能缺失处理。
