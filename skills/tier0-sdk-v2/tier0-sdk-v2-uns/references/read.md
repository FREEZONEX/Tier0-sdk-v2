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
  const records = await client.uns.recordFind({
    collectionId, filter: { enabled: true }, sort: [['name', 1]], limit: 20,
  });
  return { items: records.data.items, pageInfo: records.data.pageInfo };
}

export async function listCollections(page = 1, client: Tier0Client = createClient()) {
  return client.uns.metadataFind({
    kinds: ['collection'], state: 'active', sort: [['_id', 1]], page: { mode: 'offset', page, size: 20 },
  });
}
```

按 pageInfo.hasMore/nextPage 继续元数据分页；不要把第一页当全量。recordFind 的游标循环见[数据工作流](data-workflows.md)。sort 是数组元组。

已知 collectionId 时直接读取记录，由服务端校验集合及操作权限；不先调用 metadataFind、dataAppContext、collectionDescribe 或 ensure。需要选择集合或查看结构时，再单独读取对应上下文。

listCollections 的 metadataFind 仅用于 Workspace 集成（会话、personal / agent Key）。App 凭证不能调用 metadataFind；未知 collectionId 时用 dataAppContext 选择已授权集合，集合的 revision、indexStatus、ttl 也在其中。readDevices 只需要目标集合的记录读取权限。网络/权限错误必须传播，不能用空数组掩盖错误。
