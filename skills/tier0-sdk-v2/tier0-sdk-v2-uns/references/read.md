# 查询集合与记录

## App Key：从授权上下文读取

App Key 已知集合 ID 时直接调用 `recordFind`；需要发现集合时使用 `dataAppContext`，不调用 `namespace`、`metadataFind` 或 `appCollectionsList`。上下文包含可访问集合的名称、目录路径、Schema 和有效权限；按已配置 alias 精确定位，不能随意选择列表第一项。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

// 在服务端使用 App Key；alias 是应用配置中的稳定集合别名。
export async function readAppRecords(alias: string, client: Tier0Client = createClient()) {
  const context = await client.uns.dataAppContext({});
  const collection = context.data.collections.find(item => item.alias === alias);
  if (!collection || !collection.permissions.includes('record:read')) {
    throw new Error('当前 App 上下文没有该别名的可读集合，请核对别名、授权和凭证');
  }
  return client.uns.recordFind({ collectionId: collection.collectionId, limit: 20 });
}
```

未找到别名不等于集合不存在；共享授权可能没有 alias，应使用明确配置的集合 ID。上下文只是发现结果，后续请求仍由服务端重新检查权限。网络或权限错误应传播，不转换成“零条记录”。此例只读取第一页，后续按返回的 `pageInfo` 继续查询。

## 工作空间凭证：查询元数据与记录

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

## 回收集合的历史读取

按原 collectionId 读取 Record、Sample、count 或 aggregate；既有授权和字段权限仍生效。活跃 Topic 可继续读取其引用的回收集合。活跃 App 的 dataAppContext 保留仍可读的回收集合，但不授予新增能力；回收中的 App 自身不能运行。

已知 ID 直接读取，不必先恢复集合或查询元数据。数据层也可用 `data.collection({ collectionId })`，不会 ensure、写种子或补授权。只有 Workspace 集成确需回收对象定义时，才用 metadataFind 的 state=deleted 或 all；App Key 仍不调用该接口。[回收规则](delete.md#回收规则)说明写入和恢复边界。
