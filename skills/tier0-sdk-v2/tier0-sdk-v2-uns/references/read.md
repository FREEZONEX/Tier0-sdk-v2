# 查询集合与记录

| 方法 | 必要输入 | 返回 data |
| --- | --- | --- |
| metadataFind | kinds；可选 filter、sort、projection、page、state | items、pageInfo |
| metadataFind + limit:1 | kind、filter；可选 state | 取 items[0]，空结果视为未匹配 |
| metadataCount / metadataAggregate | kind/kinds 与查询条件；去重 pipeline 为 [{ $distinct: field }] | count / items、pageInfo；去重每项为 {value} |
| collectionDescribe | collectionId | 集合结构和数据能力 |
| recordFind | collectionId；可选 filter、sort、limit、cursor | items、pageInfo |

元数据查询配置字段写 name、parentId；系统字段写 _id、_meta.kind、_meta.revision。返回资源的配置在 items[].data 中。state 为 active/deleted/all，默认 active。对象身份始终是 kind + id。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function readDevices(collectionId: string, client: Tier0Client = createClient()) {
  const collection = await client.uns.metadataFind({ kind: 'collection', filter: { _id: collectionId }, limit: 1 });
  const definition = collection.data.items[0];
  if (!definition) throw new Error('集合不存在或不可见');
  const records = await client.uns.recordFind({
    collectionId, filter: { enabled: true }, sort: [['name', 1]], limit: 20,
  });
  return { definition: definition.data, items: records.data.items, pageInfo: records.data.pageInfo };
}

export async function listCollections(page = 1, client: Tier0Client = createClient()) {
  return client.uns.metadataFind({
    kinds: ['collection'], state: 'active', sort: [['_id', 1]], page: { mode: 'offset', page, size: 20 },
  });
}
```

按 pageInfo.hasMore/nextPage 继续元数据分页；不要把第一页当全量。recordFind 的游标循环见[数据工作流](data-workflows.md)。sort 是数组元组。

以上 metadataFind 示例用于 Workspace 集成（会话、personal / agent Key）。App 凭证不能调用 metadataFind：用 dataAppContext 精确选择授权 alias，集合的 revision、indexStatus、ttl 也在其中。数据授权不等于元数据管理授权。网络/权限错误必须传播，不能用空数组掩盖错误。
