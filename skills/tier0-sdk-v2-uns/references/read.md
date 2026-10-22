# 查询集合与记录

| 方法 | 必要输入 | 返回 data |
| --- | --- | --- |
| collectionList | 可选 page、size、search、archived | list、total、hasMore、nextPage |
| collectionGet | id | kind、id、revision、data（Schema/元数据） |
| collectionDescribe | collectionId | 集合结构和数据能力 |
| recordFind | collectionId；可选 filter、sort、limit、cursor | items、pageInfo |
| recordCount | collectionId；可选 filter | 计数结果 |

集合详情有两层 data：响应.data 是资源，响应.data.data 才是集合定义。记录行是 `{id,data,revision,…}`，过滤业务路径用 name，系统字段用 _id、_meta.revision；不要写 data.name。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function readDevices(collectionId: string, client: Tier0Client = createClient()) {
  const collection = await client.uns.collectionGet({ id: collectionId });
  const records = await client.uns.recordFind({
    collectionId, filter: { enabled: true }, sort: [['name', 1]], limit: 20,
  });
  return { schema: collection.data.data.recordSchema, items: records.data.items,
    pageInfo: records.data.pageInfo };
}
export async function readDevice(collectionId: string, id: string, client: Tier0Client = createClient()) {
  const result = await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 });
  return result.data.items[0] ?? null;
}
```

recordFind 的 limit 为 1–200；按 pageInfo.hasMore/nextCursor 继续，完整循环见[数据工作流](data-workflows.md)。不要把第一页当全量，sort 是数组，不是 MongoDB 对象。

App 使用 dataAppContext 精确选择授权 alias；Workspace 集成使用 dataDiscover/collectionList。数据访问授权不等于集合管理授权。网络/权限错误必须传播，不能返回空数组掩盖错误。
