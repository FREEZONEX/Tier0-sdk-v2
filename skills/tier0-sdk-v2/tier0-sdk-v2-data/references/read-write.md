# 记录读写

`data.collection(declaration)` 或 `data.collection({collectionId})` 返回集合句柄。SDK 文档为 `{_id,...业务字段,_meta}`；过滤、排序、投影直接写 status/customer.id/_meta.revision，不加 data.。

完整匹配范围必须一起修改时，使用 `updateManyAtomic(filter, update, { arrayFilters?, idempotencyKey?, dryRun?, requireIndexesReady? })`，返回计数、数据库 transactionTime 和 replayed/dryRun。此预览方法要求相应后端能力；它只发一次范围更新，不续页或降级为 updateMany，结果未知时不自动重发。旧 updateMany 继续允许部分提交。详见[一致性](consistency.md)。

```ts
import { createDataClient } from '@tier0/sdk-v2/data';

const data = createDataClient({});
const orders = data.collection<{ code: string; status: string; notes?: string }>({ collectionId: 'orders-id' });

export async function listOrders(page: number) {
  return orders.findPage({ status: 'RELEASED' }, { sort: { code: 1 }, page, pageSize: 20 });
}

export async function saveNote(id: string, revision: number, notes: string) {
  return orders.updateOne({ _id: id }, { $set: { notes } }, { expectedRevision: revision });
}

export async function createOrder(code: string, intentKey: string) {
  return orders.insertOne({ code, status: 'DRAFT' }, { returnDocument: 'after', idempotencyKey: intentKey });
}
```

## 查询

列表、搜索、报表和普通详情由 App 服务端按当前访问者权限与授权范围查询，读到结果后直接返回。普通查询省略读后 `data.transact` 或 `record.check` 复核。需要同一请求快照的多项统计和明细使用 `queryBatch`。只有业务明确要求检测跨请求变化时，才设计额外的版本校验。写入时的状态与版本前置条件见 [一致性](consistency.md)。

`find()` / `aggregate()` 游标支持 `.batchSize(10).limit(100)`：每次网络请求最多取 10 条，完整迭代仍返回最多 100 条。默认批次大小仍为 200，必须在迭代开始前设置。`find()` 的 batchSize 仍为 1–200；`aggregate()` 可显式请求更大批次，要求正安全整数且 `size + 1` 和偏移量可精确表示，并需要配套后端更新。偏移分页在整次迭代中保持同一个大小，最后一页也不改变大小，避免漏行或重复。每个查询仍受 8 MiB 响应预算、超时和后端偏移上限约束；大证据记录可用较小批次避免单响应超限，但这不是提高单记录上限，也不保证多次请求共享快照。`toArray()` 最终仍将全部结果留在内存；需要逐行处理时用 `for await`。参考 [MongoDB cursor batchSize](https://www.mongodb.com/docs/manual/reference/method/cursor.batchsize/) 的批次大小与结果数量分离约定。

| 方法 | 返回与用途 |
| --- | --- |
| find(filter,options) | 游标；toArray 取结果，显式给 limit |
| findOne(filter) | 文档或 null |
| get(ids) | `{items,missing}`，按请求 ID 首次出现顺序去重；所有 ID 单请求读取，不自动切块 |
| findPage(filter,{page,pageSize,...}) | `{items,total:{count,capped},page,pageSize}`，列表与总数同请求 |
| countDocuments(filter,{maxCount}) | `{count,capped}`，只需角标阈值时设较小 maxCount |
| countBy(field,filter) | `[{value,count}]`，按字段分组 |
| distinct(field,filter) | 取完所有页的去重值 |
| aggregate(pipeline) | 服务端统计游标，支持受限聚合与 lookup |

capped:true 显示 N+，不要当精确总数。get 的 missing 包含不存在或不可读 ID。find / findPage 每页最多 200 行；aggregate 默认每页 200 行，可显式调整。get 不受分页行数限制；跨请求游标不是固定快照。

过滤支持比较、集合、逻辑和数组操作符；`$contains` 是 1–256 字节的字符串子串匹配，仅 ASCII 字母忽略大小写，无通配符/正则，不能利用索引。`$in` / `$nin` 值数没有固定上限，仍受请求与超时约束；sort 最多 4 字段，宽泛查询可能 QUERY_TIMEOUT。

聚合表达式支持 `{ $in: ['$level1', { $literal: selectedNames }] }`，可放入 `$cond` 后在数据库内做条件计数。第二项也可为返回标量数组的表达式；literal 数组允许为空，无固定数量上限，元素限字符串、数字、布尔和 null。左值缺失按 null 比较，不做字符串/数字类型转换；右侧数组缺失、为 null，或包含对象/嵌套数组会报 INVALID_REQUEST。这里的 literal 数组仅用于 `$in` 第二项，不扩大通用 `$literal` 类型。它与字段过滤器的 null/缺失语义不同，不能直接把字段 `$nin` 改写为 `$not($in)`。SDK 原样发送，不拆块或在本地计算；需要配套后端能力。

`$lookup` 的普通关联由数据库按输入记录执行，不再固定限制外层记录数、候选行数或单记录匹配行数。每条输入及其关联结果仍受实际 8 MiB 字节预算约束，查询响应、授权、执行期限与索引要求仍适用；使用子管线先筛选、投影或汇总，减少最终数组大小。

## 同一页面的多项读取

```ts
import { createDataClient } from '@tier0/sdk-v2/data';

const data = createDataClient({});
const orders = data.collection<{ code: string; status: string }>({ collectionId: 'orders-id' });

export async function dashboard(page: number, selectedId: string) {
  return data.queryBatch({
    list: orders.query.findPage({}, { sort: { code: 1 }, page, pageSize: 20 }),
    byStatus: orders.query.countBy('status'),
    selected: orders.query.get([selectedId]),
  });
}
```

queryBatch 接受非空的命名查询集合，同一请求共享快照；无需快照一致性时不强制使用。默认单项失败抛 DataError，`{settle:true}` 按项返回 `{ok,value|error}`。普通 find / findPage 每页仍最多 200 行，aggregatePage 可显式请求更大页；每个子查询仍受 8 MiB 响应预算约束，不再限制子查询数量、整批行数或整批 8 MiB 大小。`$in` 值数和 `get` ID 数没有固定上限，仍须满足类型、非空、请求和超时约束。能力 limits 中对应的数值 0 表示无该维度上限，不能作为分组步长。支持 query.find/findPage/count/countBy/distinct/aggregate/aggregatePage/get。

语句超时或任一子查询超过其响应字节预算时整批失败，`settle:true` 也不会返回部分结果。独立 `collection.get([])` 保持本地空结果、不发请求；批内 `query.get([])` 仍拒绝空 ID 数组。旧后端仍可能拒绝超过旧数量上限的请求，SDK 不自动切块回退，需要配套后端更新。

`query.aggregatePage(pipeline, { page, pageSize })` 读取显式偏移页并返回 `{items,pageInfo}`；默认第 1 页、每页 200 条，pageSize 可大于 200，要求正安全整数且 `pageSize + 1` 和 `(page - 1) * pageSize` 可精确表示。后端偏移上限仍适用。`pageInfo.hasMore/nextPage` 保留后续页信息，`snapshotScope:'thisRequestOnly'` 表示只有本次 queryBatch 共享快照。需要继续时保持授权范围、管线和 pageSize 不变，按 nextPage 发起下一次调用；不会自动取全量或把多次调用变成同一快照。排序应有稳定的唯一兜底字段。原 `query.aggregate/countBy/distinct` 仍只返回首页数组；需要自动完整迭代可用 `collection.aggregate()` 游标。

```ts
import { createDataClient } from '@tier0/sdk-v2/data';

const data = createDataClient({});
const orders = data.collection<{ code: string; status: string }>({ collectionId: 'orders-id' });
const groups = orders.query.aggregatePage<{ _id: string; count: number }>([
  { $match: { status: 'RELEASED' } },
  { $group: { _id: '$code', count: { $sum: 1 } } },
  { $sort: { _id: 1 } },
], { page: 1, pageSize: 100 });
const result = await data.queryBatch({ groups });
// 使用 result.groups.items 展示本页，按 result.groups.pageInfo 决定是否继续。
```

终结于 `$count` 的管线不接受分页，继续使用 `query.aggregate` 或 `query.count`。新方法复用既有聚合协议和请求预算，不要求后端新增接口；大于 200 的页需要配套后端更新，旧后端拒绝时不自动切块回退。

## 写入

| 方法 | 语义 |
| --- | --- |
| insertOne/insertMany | 可传 _id；新增不会更新同 ID |
| updateOne/updateMany | 操作符更新，例如 $set/$inc/$unset/$push |
| replaceOne | 完整替换，会移除 replacement 以外的业务字段 |
| deleteOne/deleteMany | 软删除 Record，同时物理删除关联 Sample |
| findOneAndUpdate/Replace/Delete | 原子读改写，返回所选快照 |
| bulkWrite | 同集合混合写入，原子 |
| data.transact | 跨集合原子步骤，见 [一致性](consistency.md) |

insertOne 默认返回 insertedId；指定 returnDocument:'after' 同时返回扁平 value 和 `_meta.revision`，无需额外查询。projection 仅随 after，投影后的业务字段类型可选，_id/_meta 仍有。返回快照额外需要当前读取权限，首次提交与重放均校验；重放是原创建快照，不是当前最新版。

## 批量与原子性

insertMany、bulkWrite 每次最多 200 项，全部成功或回滚。只有业务允许各块独立提交时才分块。跨文档不变量必须保留在一次 transact：旧服务端最多 200 步，支持 limits.transaction 的服务端由 SDK 实时协商，客户端上限 10,000；超限拒绝，不自动拆批。大事务仍受服务端请求体、响应体和执行时间限制。

updateMany/deleteMany 分页处理全部匹配，整体非原子。部分提交失败保留累计计数及 resumeAfter，execution 为 committed；只续做剩余部分，不整体重跑 $inc/$push。execution:unknown 表示失败页可能已生效，先核对。详细字段见 [错误处理](errors.md)。

写入前按本地 schema 严格验证；读取兼容其他代码版本新增的字段/枚举与缺失字段。版本编辑传 expectedRevision，冲突重新读取。

## 订阅变更

```ts
import { createDataClient, type SubscriptionEvent } from '@tier0/sdk-v2/data';

const data = createDataClient({});
const orders = { collectionId: 'orders-id' };

export async function subscribe(handle: (event: SubscriptionEvent) => void, signal: AbortSignal) {
  for await (const event of data.subscribe({ collections: [orders], signal })) handle(event);
}
```

订阅自动处理心跳、重连和 Last-Event-ID。change 仅含 collection/collectionId/recordId/revision/change 等标识，收到后重读；不保证版本按序，SDK 去掉已见旧的非 delete，delete 始终投递并清除已见版本。reset（CURSOR_EXPIRED/SCOPE_CHANGED）后重读当前视图。明确不可重试错误会抛 DataError。

默认订阅已声明集合，每条订阅最多 64 个；声明超过 64 个集合时，显式选择需要监听的集合，不要将声明配额当成订阅配额。recordIds 最多 100 个且只能对应一个集合。已有 ID 引用的 collection 事件字段是该 ID。一个服务端进程共享一条订阅并扇出，避免每个浏览器建立一条平台连接。

## 把变更推给浏览器

createChangeRelay(data) 在 App 服务端共享上游，relay.stream 返回 App 路由 SSE。使用可信访问者身份按业务规则过滤实时和重放事件；recordId 本身也可能透露信息。记录的重读接口执行同样权限规则。

```ts
import { createChangeRelay, createDataClient, type RecordChange } from '@tier0/sdk-v2/data';

const data = createDataClient({});
const relay = createChangeRelay(data, { collections: [{ collectionId: 'orders-id' }] });

export function streamChanges(request: Request, canSee: (change: RecordChange) => boolean): Response {
  return relay.stream({ filter: canSee, lastEventId: request.headers.get('Last-Event-ID'), signal: request.signal });
}
```

浏览器使用 SDK event-stream 的 openEventStream，页面隐藏断开、恢复时续传。收到 change 重读对应数据，reset 重载视图，unavailable 显示暂不可用。浏览器游标属于转发器，不是 UNS 游标；换进程、缓冲区过期或上游 reset 均可能要求重载，不依赖无限保留。
