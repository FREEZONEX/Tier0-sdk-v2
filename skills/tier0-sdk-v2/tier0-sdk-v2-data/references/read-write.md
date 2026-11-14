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

| 方法 | 返回与用途 |
| --- | --- |
| find(filter,options) | 游标；toArray 取结果，显式给 limit |
| findOne(filter) | 文档或 null |
| get(ids) | `{items,missing}`，按请求 ID 顺序；超过 100 个自动分批 |
| findPage(filter,{page,pageSize,...}) | `{items,total:{count,capped},page,pageSize}`，列表与总数同请求 |
| countDocuments(filter,{maxCount}) | `{count,capped}`，只需角标阈值时设较小 maxCount |
| countBy(field,filter) | `[{value,count}]`，按字段分组 |
| distinct(field,filter) | 取完所有页的去重值 |
| aggregate(pipeline) | 服务端统计游标，支持受限聚合与 lookup |

capped:true 显示 N+，不要当精确总数。get 的 missing 包含不存在或不可读 ID。单次读取最多 200 行，跨请求游标不是固定快照。

过滤支持比较、集合、逻辑和数组操作符；`$contains` 是 1–256 字节的字符串子串匹配，仅 ASCII 字母忽略大小写，无通配符/正则，不能利用索引。`$in` 最多 200 值，sort 最多 4 字段；宽泛查询可能 QUERY_TIMEOUT。

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

queryBatch 最多 20 项，同一快照；无需快照一致性时不强制使用。默认单项失败抛 DataError，`{settle:true}` 按项返回 `{ok,value|error}`。单项最多 200 行，整批 2000 行/8 MiB 上限；支持 query.find/findPage/count/countBy/distinct/aggregate/get。

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

默认订阅已声明集合（最多 64 个）；recordIds 最多 100 个且只能对应一个集合。已有 ID 引用的 collection 事件字段是该 ID。一个服务端进程共享一条订阅并扇出，避免每个浏览器建立一条平台连接。

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
