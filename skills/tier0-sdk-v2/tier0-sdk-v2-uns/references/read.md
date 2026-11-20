# 读取集合与记录

已知 collectionId 时直接读记录，无需 metadata/context/ensure 预检。需要发现集合时，App 用 dataAppContext，工作区管理身份用 metadataFind。名称或 alias 不能当作集合 ID。

普通列表、搜索、报表和详情按当前授权范围读取并直接返回，省略读后的 `recordTransactionExecute` 或 `record.check` 复核。App 服务端负责落实访问者的业务权限与记录范围。需要同一请求快照的多项读取用 `recordQueryBatch`。分页的快照范围和写入事务见 [数据工作流](data-workflows.md)。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function readRecords(collectionId: string, client: Tier0Client = createClient()) {
  return client.uns.recordFind({
    collectionId, filter: { enabled: true }, sort: [['name', 1]], limit: 20,
  });
}

export async function findAppCollection(alias: string, client: Tier0Client = createClient()) {
  const { data } = await client.uns.dataAppContext({});
  return data.collections.find(item => item.alias === alias);
}
```

共享 grant 可以没有 alias，优先使用应用已配置的 ID。context 是发现结果，后续请求仍检查当前权限；网络或权限错误不能转换为空数组。

## 元数据与分页

metadataFind 接收 kind 或 kinds（二选一）、filter/sort/projection/page/state，返回 items/pageInfo。配置路径写 name/parentId，系统路径 _id/_meta.kind/_meta.revision；返回配置在 items[].data。state 为 active（默认）、deleted、all。App 运行时不能调用此接口。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function listCollections(page = 1, client: Tier0Client = createClient()) {
  return client.uns.metadataFind({
    kind: 'collection', state: 'active', sort: [['_id', 1]],
    page: { mode: 'offset', page, size: 20 },
  });
}
```

按 pageInfo.hasMore/nextPage 翻元数据页，按 nextCursor 翻记录页，单页不是全量。原始 sort 是元组数组；SDK data 层才使用 sort 对象。Record 返回 `{id,data,revision,...}`，filter/update 却直接写业务字段，不加 data.。

## 聚合查询计划

后端支持聚合 explain 时，沿用 `recordExplain`，传 `op: 'aggregate'` 与实际查询相同的 `pipeline`、`page` 或 `limit`。`page` 与 `limit` 互斥，游标放在 `page.cursor`；不要为了诊断换成另一组筛选或分页。它复用实际聚合编译与来源授权，只运行 EXPLAIN，不执行聚合，不返回实际行数/耗时或样本。`count` 和 ANALYZE 不在这个入口中。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function explainSiteTotals(collectionId: string, siteId: string, client: Tier0Client = createClient()) {
  const query = {
    collectionId,
    pipeline: [
      { $match: { siteId } },
      { $group: { _id: '$status', total: { $sum: 1 } } },
      { $sort: [['_id', 1]] },
    ],
    page: { mode: 'offset', page: 1, size: 25 },
  } satisfies UnsV2Request<'recordAggregatePipeline'>;
  return client.uns.recordExplain({ ...query, op: 'aggregate' });
}
```

保留返回信封的 `requestId`，检查 `data.plan` 的扫描、连接和排序计划。估计行数不是实际匹配数；不支持的新后端能力应明确报错，不回退为执行聚合。原 `find/updateMany/deleteMany` explain 仍是有界范围评估，可能读取样本，不能把它们称为纯规划。

## 回收集合的历史读取

回收集合保留 Record、Sample 与索引，按既有未撤销授权只读；无需先恢复。活跃 App 的 context 保留仍可读的回收集合，仅给读取权限。App 被回收后自身不能运行。

SDK 数据层可用 `data.collection({collectionId})` 读历史，不 ensure、不补授权。写入需恢复原集合或所属 App/目录，具体范围见 [回收规则](delete.md#回收规则)。
