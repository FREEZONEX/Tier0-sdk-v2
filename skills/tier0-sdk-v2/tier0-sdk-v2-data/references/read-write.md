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
  const listPage = await orders.findPage({ status: 'RELEASED' }, { sort: { code: 1 }, page, pageSize: 20 });
  const released = await orders.countDocuments({ status: 'RELEASED' });
  const totals = await orders
    .aggregate<{ _id: string; total: number }>([{ $match: { status: 'DONE' } }, { $group: { _id: '$line.id', total: { $sum: '$targetQty' } } }])
    .toArray();
  return { recent, listPage, released, totals };
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
| `findPage(filter, { sort, page, pageSize })` | 带总数的页码分页 `{ items, total, page, pageSize }`，pageSize 最多 200 |
| `countDocuments(filter)`、`distinct(field, filter)` | `distinct` 会取完所有页 |
| `aggregate(pipeline)` | `$match` `$sort` `$group` `$project` `$set` `$unwind` `$skip` `$limit` `$count` `$lookup`；`$lookup.from` 写声明或 alias，数据层换成集合 ID。`$exists` / `$distinct` / `$frequencies` 阶段不执行，改用 `countDocuments`、`distinct` 或 `$group` |

| 写入 | 说明 |
| --- | --- |
| `insertOne(doc)`、`insertMany(docs)` | 可带 `_id`；`insertMany` 最多 200 条、原子 |
| `updateOne` / `updateMany` / `replaceOne` | 更新用操作符（`$set` `$inc` `$push` `$unset`…）；单条 update/replace 默认只返回计数，returnDocument:'before'|'after' 额外返回 value；`replaceOne` 会丢掉其他代码版本写入的字段 |
| `deleteOne` / `deleteMany` | 软删除，App Key 需要 `uns.delete`；deleteOne 可用 returnDocument:'before' 额外返回删除前的 value |
| `findOneAndUpdate` / `findOneAndReplace` / `findOneAndDelete` | 兼容入口，保留原路由、原返回值与默认模式；新请求用单条 canonical 写入的 returnDocument |
| `bulkWrite(ops)` | `insertOne` / `updateOne` / `replaceOne` / `deleteOne` 混合，最多 200 项、原子 |
| `data.transact(steps)` | 跨集合原子写，见 [一致性](consistency.md) |

## 批量与原子性

`projection` 必须与显式 `returnDocument:'before'|'after'` 同传；未匹配时 `value` 为 null。所有旧方法的路由不变，恢复已发送的请求必须保留操作与幂等键，不能改投新方法。

| 调用 | 上限 | 原子 |
| --- | --- | --- |
| `insertMany`、`bulkWrite`、`data.transact` | 每次 ≤200 项，超过在发送前抛 `BATCH_LIMIT_EXCEEDED` | 是，全部或全不 |
| `updateMany`、`deleteMany` | 无上限，翻页处理所有匹配 | 否，逐条提交；失败抛 `WRITE_ERRORS` 并报告已提交的数量 |

超过 200 条按 200 分块写入（循环分块即可），每块用固定 `_id` 或独立 `idempotencyKey`，重试不会重复。多条文档必须一起成功或失败时，用一次 `data.transact`（≤200 步），不要用 `updateMany`。不要在循环里逐条调用数据层：读用一次 `$in`，写用 `insertMany` / `updateMany` / `bulkWrite` 或 `data.transact`。

## 过滤

支持 `$eq $ne $gt $gte $lt $lte $in $nin $exists $all $size $elemMatch $not $and $or $nor` 和 `$contains`。`$contains` 是子串匹配（1–256 字节，无通配符和正则），只对 ASCII 字母忽略大小写；缺失、null、非字符串值不匹配；只能用于声明为字符串的字段，用在数组或数字字段上返回 `INVALID_REQUEST`。它不能使用索引，大集合上可能触发 15 秒语句超时（`QUERY_TIMEOUT`），要和有索引的条件一起用。`$in` 最多 200 个值，排序最多 4 个字段（`toSortPairs` 也导出给自定义查询转换使用）。

## 校验

写入前按声明严格校验：未知字段、类型错误、未声明的更新路径抛 `ZodError`（HTTP 400 语义）。读取不严格解析：记录可能含其他代码版本写入的字段、新的枚举值，或缺少后来新增的字段。枚举渲染要有兜底标签，后加的字段按可能缺失处理。
