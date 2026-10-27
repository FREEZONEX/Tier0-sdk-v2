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
    targetQty: z.number().int().min(1).meta({ format: 'int32' }),
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

export async function createWorkOrder(
  code: string, line: { id: string; name: string }, targetQty: number, intentKey: string,
) {
  const { value } = await orders.insertOne({ code, status: 'DRAFT', line, targetQty }, {
    returnDocument: 'after', projection: { code: 1, 'line.name': 1 }, idempotencyKey: intentKey,
  });
  // 投影后的业务字段可能缺失，元信息仍必有；revision 可交给下一次更新。
  return { id: value._id, revision: value._meta.revision, code: value.code, lineName: value.line?.name };
}
```

## 一个页面一次请求：`data.queryBatch`

页面要同时显示列表、总数、各状态数量、某条记录时，用 `data.queryBatch` 把这些读取合成一次请求（最多 20 个），结果来自同一个快照，不要分别发多个请求：

```ts
import { z } from 'zod';
import { createDataClient, defineCollection } from '@tier0/sdk-v2/data';

const workOrders = defineCollection({
  alias: 'work_orders',
  schema: z.object({ code: z.string(), status: z.enum(['DRAFT', 'RELEASED', 'DONE']) }),
  indexes: [{ path: 'code', unique: true }, { path: 'status' }],
});
const data = createDataClient({ collections: [workOrders] });
const orders = data.collection(workOrders);

export async function ordersScreen(page: number, selectedId: string) {
  const { list, byStatus, selected } = await data.queryBatch({
    list: orders.query.findPage({ status: { $ne: 'DONE' } }, { sort: { code: 1 }, page, pageSize: 20 }),
    byStatus: orders.query.countBy('status'),
    selected: orders.query.get([selectedId]),
  });
  return { list, byStatus, selected: selected.items[0] ?? null };
}
```

- 读取用 `collection.query.*` 构造：`find`（首页，可带 `maxCount` 附带总数）、`findPage`、`count`、`countBy`、`distinct`、`aggregate`、`get`；每项只返回一页（最多 200 行），`get` 最多 100 个 ID。
- 结果按名字返回，类型与对应方法一致。名字只能用字母、数字、`_` `.` `-`。
- 某一项被拒（过滤条件不合法、无授权）时整个调用抛出该项的 `DataError`；传 `{ settle: true }` 则每项返回 `{ ok: true, value }` 或 `{ ok: false, error }`。语句超时或整批超过 2000 行 / 8 MiB 时整批失败。

## 方法

| 读取 | 说明 |
| --- | --- |
| `find(filter, { sort, limit, projection })` | 游标，每页最多 200 条；列表读取始终给 `limit` |
| `findOne(filter)` | 无匹配返回 `null` |
| `get(ids, { projection })` | 按 `_id` 读取，返回 `{ items, missing }`，`items` 按请求顺序（重复的 ID 只取第一次出现）；不存在、已删除或员工无权查看的 ID 一律进 `missing`。超过 100 个自动分批 |
| `findPage(filter, { sort, page, pageSize, maxCount })` | 页码分页，一次请求返回 `{ items, total: { count, capped }, page, pageSize }`；pageSize 最多 200，总数默认数到 10000（`maxCount` 最多 100000），超过时 `capped: true` |
| `countDocuments(filter, { maxCount })` | 返回 `{ count, capped }`，默认数到 100000；只要阈值时给小的 `maxCount`（如角标 `99+`） |
| `countBy(field, filter)` | 每个取值的数量 `[{ value, count }]`，从多到少；一次 `$group` |
| `distinct(field, filter)` | 会取完所有页 |
| `aggregate(pipeline)` | `$match` `$sort` `$group` `$project` `$set` `$unwind` `$skip` `$limit` `$count` `$lookup`；`$lookup.from` 写声明或 alias，数据层换成集合 ID。`$exists` / `$distinct` / `$frequencies` 阶段不执行，改用 `countBy`、`distinct` 或 `$group` |

| 写入 | 说明 |
| --- | --- |
| `insertOne(doc, options)`、`insertMany(docs)` | 可带 `_id`；单条默认返回 `{ insertedId }`，`returnDocument:'after'` 同次写入返回 `{ insertedId, value }`；`insertMany` 最多 200 条、原子 |
| `updateOne` / `updateMany` / `replaceOne` | 更新用操作符（`$set` `$inc` `$push` `$unset`…）；`replaceOne` 会丢掉其他代码版本写入的字段 |
| `deleteOne` / `deleteMany` | 软删除，App Key 需要 `uns.delete` |
| `findOneAndUpdate` / `findOneAndReplace` / `findOneAndDelete` | 原子读改写，默认返回更新后的文档 |
| `bulkWrite(ops)` | `insertOne` / `updateOne` / `replaceOne` / `deleteOne` 混合，最多 200 项、原子 |
| `data.transact(steps)` | 跨集合原子写，见 [一致性](consistency.md) |

新建后需要显示保存结果或继续按版本编辑时，使用 `insertOne(doc, { returnDocument: 'after', idempotencyKey })`。`value` 与查询结果一样是 `{ _id, ...业务字段, _meta }`，包含服务端生成的数据和 `_meta.revision`，无需额外查询。返回快照需要当前读取权限；`projection` 只能与 `after` 一起提供。重放返回当次创建的快照，不能当成记录当前最新版本；之后的版本冲突仍需显式读取并处理。

带 `projection` 时，返回类型将业务字段递归标为可选，包括嵌套对象和数组元素的字段；读取前需判断是否存在。`_id` 和 `_meta` 仍然必有。不带 `projection` 的 `after` 保持完整文档类型。

上面的 createWorkOrder 在一次记录写入中取得投影和修订；首次使用集合时仍会先 ensure 声明，不代表首次调用总共只有一次 HTTP。用于跨调用恢复时保存 intentKey，并重发同一创建意图；不要把原来的默认返回改为 after 来补取数据。读取权限在首次提交和历史重放时都检查，具体边界见 [UNS 创建快照](../../tier0-sdk-v2-uns/references/create.md)。

## 批量与原子性

| 调用 | 上限 | 原子 |
| --- | --- | --- |
| `insertMany`、`bulkWrite`、`data.transact` | 每次 ≤200 项，超过在发送前抛 `BATCH_LIMIT_EXCEEDED` | 是，全部或全不 |
| `updateMany`、`deleteMany` | 无上限，翻页处理所有匹配 | 否，逐条提交；已有提交后失败时错误保留原 `code`，`execution: 'committed'`、`retry.safe: false`，`details` 是累计结果（`matchedCount` 等、`status: 'partiallyCommitted'`、续做位置 `resumeAfter`） |

超过 200 条按 200 分块写入（循环分块即可），每块是一次独立的原子调用：数据层自动给每次调用生成幂等键并在重试中复用，不需要手写；要让“某块写过就不再写”跨进程重启也成立，用固定 `_id`（或按业务意图显式传 `idempotencyKey`）。多条文档必须一起成功或失败时，用一次 `data.transact`（≤200 步），不要用 `updateMany`。不要在循环里逐条调用数据层：读用一次 `get` / `$in` 或 `queryBatch`，写用 `insertMany` / `updateMany` / `bulkWrite` 或 `data.transact`。

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

## 订阅变更

`data.subscribe(...)` 返回已提交变更的异步迭代器（UNS `records:subscribe`，服务端推送）：断线、超时、服务端结束都自动续传（`Last-Event-ID`），刷新页面不需要轮询。事件只有标识，不带业务数据，收到后按需重新读取。

```ts
import { z } from 'zod';
import { createDataClient, defineCollection, runAsApp, type SubscriptionEvent } from '@tier0/sdk-v2/data';

const tickets = defineCollection({ alias: 'tickets', schema: z.object({ title: z.string(), status: z.enum(['OPEN', 'DONE']) }) });
const data = createDataClient({ collections: [tickets] });

/** 一个进程一条 App 级订阅，在进程内扇出给浏览器。 */
export async function pumpChanges(send: (event: SubscriptionEvent) => void, signal: AbortSignal) {
  await runAsApp(async () => {
    for await (const event of data.subscribe({ collections: [tickets], signal })) {
      // reset：续传位置失效或访问范围变化，浏览器应重新读取当前数据。
      send(event);
    }
  });
}
```

- 事件：`{ type: 'change', eventId, collection（alias）, collectionId, change: 'record' | 'delete', recordId, revision, occurredAt, restricted }`、集合级通知 `{ type: 'change', …, change: 'collection', restricted: true }`（没有 `recordId` / `revision`），或 `{ type: 'reset', reason, message? }`。心跳与重连在 SDK 内部处理；迭代抛出 `DataError` 表示不能再重试（如 403），正常结束只有 `signal` 中止或跳出循环。
- 事件按写入事务的顺序到达，不是提交顺序，同一记录的 revision 可能乱序。SDK 已丢弃 revision 不大于该记录已投递 revision 的非 `delete` 变更；`delete` 一律投递（迟到的也投递），并清除该记录的 revision（同一 ID 再写入时可能从 1 开始）。收到事件后按 `recordId` 重新读取，不要用事件顺序推断记录的最终状态。
- `reset`：`CURSOR_EXPIRED`（续传位置已被清理、游标无法解开或租户库已迁移）或 `SCOPE_CHANGED`（访问范围变化，例如集合不再可读）。重新读取当前数据；SDK 随后不带续传位置重新订阅。
- `restricted: true`：该集合有员工数据规则。以 App 身份打开的订阅能看到所有记录的变更，所以默认把这类变更换成集合级通知，可以直接转发给任何员工的浏览器，浏览器再通过受规则约束的接口重新读取。只有不转发给浏览器的服务端逻辑才传 `restricted: 'record'` 拿完整事件（转发前仍须逐个经 `redactRestricted`）。
- 默认订阅全部已声明的集合（最多 64 个）；`recordIds`（最多 100 个）只能配一个集合。
- 订阅不占数据请求的并发名额，但每个租户的订阅数有上限（超出时 SDK 按 429 自动退避重连）：一个服务端进程只开一条订阅，在进程内扇出，不要每个浏览器连接开一条。App 刚导入还没就绪（`APP_NOT_READY`）时订阅会一直等待，不会结束。
- 变更保留 24 小时；`lastEventId` 太旧时收到 `reset`。`lastEventId` 必须是收到过的事件 ID（可见 ASCII），否则调用时直接抛 `TypeError`。
