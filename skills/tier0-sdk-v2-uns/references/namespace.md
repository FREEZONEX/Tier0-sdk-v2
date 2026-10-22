# 目录和 Topic

目录组织资源，Topic 是集合的 records/fields 视图，不是旧架构 Metric。增删改查使用 client.uns 的 directory*/topic*。

| 操作 | 目录 | Topic | 关键参数 |
| --- | --- | --- | --- |
| 创建 | directoryCreate | topicCreate | dryRun、items；名称必填，Topic 另需 viewMode |
| 查询 | directoryList/Get | topicList/Get | list 的 page/size/search/archived；get 的 id |
| 改元数据 | directoryUpdate | topicUpdate | items[].id、expectedRevision、name/description/parentId |
| 归档 | directoryArchive | topicArchive | items[].id、expectedRevision |
| 恢复 | directoryRestore | topicRestore | 归档对象的 id 和当前 revision |
| 改字段映射 | — | topicBindingsUpdate | 按 Topic 字段绑定契约 |

创建/更新/归档/恢复均返回 Outcome；检查 committed、results[].error。目录/Topic 的删除语义是归档，不存在 directoryDelete/topicDelete。parentId=null 表示根；更新时省略则保持原位置。归档不能自行扩展成递归清空所有后代或关联集合。

## 创建目录和集合视图

以下函数独立调用；不要把创建目录后创建 Topic 说成一个原子事务。collectionId 先从集合查询取得。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createDirectory(
  id: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.directoryCreate({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, name, parentId: null }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt, current: (await client.uns.directoryGet({ id })).data };
}
export async function createRecordTopic(
  id: string, name: string, collectionId: string, parentId: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.topicCreate({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, name, viewMode: 'records', collectionId, parentId }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt, current: (await client.uns.topicGet({ id })).data };
}
```

## 修改与归档 Topic

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function renameTopic(
  id: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const current = await client.uns.topicGet({ id });
  return client.uns.topicUpdate({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, name, expectedRevision: current.data.revision }],
  });
}
export async function archiveTopic(
  id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const current = await client.uns.topicGet({ id });
  return client.uns.topicArchive({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, expectedRevision: current.data.revision }],
  });
}
```

调用后检查 Outcome；修改后 get 核对名称，归档后 topicList({archived:true}) 遍历核对 ID。目录使用对应 directoryGet/Update/Archive；恢复从归档列表取得当前修订再 Restore，最后 get 核对。不要把 Topic 归档解释成底层 Record 已删除。
