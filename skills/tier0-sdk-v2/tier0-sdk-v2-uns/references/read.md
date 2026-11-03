# 查询集合与记录

| 方法 | 必要输入 | 返回 data |
| --- | --- | --- |
| metadataFind | kinds；可选 filter、sort、projection、page、state | items、pageInfo |
| metadataFindOne | kind、filter；可选 state | value，未找到为 null |
| metadataCount / metadataDistinct | kind/kinds 与查询条件；distinct 还指定 field | count / values、pageInfo |
| collectionDescribe | collectionId | 集合结构和数据能力 |
| recordFind | collectionId；可选 filter、sort、limit、cursor | items、pageInfo |

元数据查询配置字段写 name、parentId；系统字段写 _id、_meta.kind、_meta.revision。返回资源的配置在 value.data 或 items[].data 中。state 为 active/deleted/all，默认 active。对象身份始终是 kind + id。

回收站集合的 Record/Sample 历史查询、count 和 aggregate 仍按既有权限执行，员工行规则与字段权限继续生效；不要把正常树中不可见当成历史数据不可读。Workspace 集成读取回收对象定义时显式用 state=deleted 或 all，按原 collectionId 查询数据。活跃 Topic 可继续读取其引用的回收集合；所有数据写入仍被拒绝。以下读取定义的示例用于 Workspace 集成，App 凭证使用文末的 dataAppContext 路径。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function readDevices(collectionId: string, client: Tier0Client = createClient()) {
  const collection = await client.uns.metadataFindOne({ kind: 'collection', filter: { _id: collectionId }, state: 'all' });
  if (!collection.data.value) throw new Error('集合不存在或不可见');
  const records = await client.uns.recordFind({
    collectionId, filter: { enabled: true }, sort: [['name', 1]], limit: 20,
  });
  return { definition: collection.data.value.data, items: records.data.items, pageInfo: records.data.pageInfo };
}

export async function listCollections(page = 1, client: Tier0Client = createClient()) {
  return client.uns.metadataFind({
    kinds: ['collection'], state: 'active', sort: [['_id', 1]], page: { mode: 'offset', page, size: 20 },
  });
}
```

按 pageInfo.hasMore/nextPage 继续元数据分页；不要把第一页当全量。recordFind 的游标循环见[数据工作流](data-workflows.md)。sort 是数组元组。

活跃 App 使用 dataAppContext 精确选择授权 alias；仍有读取授权的回收集合保留在上下文中，只提供已有读能力，createCapability 不允许新增。metadataFind/FindOne 的 App 查询仍限已授权且 active 的 Collection，查询/投影限 _id/_meta/name/parentId，不可据隐藏 Schema 过滤。App 自身在回收站时不能运行，也不能借历史读取获得新授权。Workspace 集成可用 dataDiscover/metadataFind。数据授权不等于元数据管理授权。网络/权限错误必须传播，不能用空数组掩盖错误。
