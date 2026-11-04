# 删除记录与元数据

记录删除仍使用专属数据接口：

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function deleteDevice(
  collectionId: string, id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const current = (await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 })).data.items[0];
  if (!current) throw new Error('记录不存在或不可见，未执行删除');
  const receipt = await client.uns.recordDeleteOne({
    collectionId, filter: { _id: id }, expectedRevision: current.revision,
    dryRun: false, idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.deletedCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  const after = await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 });
  if (after.data.items.length) throw new Error('删除有回执，但记录仍可见或已被恢复');
  return { state: 'committed' as const, receipt };
}
```

元数据使用 metadataDeleteOne/Many，或 metadataDeleteOne + returnDocument:before 返回删除前对象。它们执行软删除，增加 revision，不隐式级联目录后代、引用对象或集合数据。集合有 Record/Sample 或配置引用不阻止明确删除；引用方保留并得到目标已删除的结果。目录和 Topic 保留原有约束，不能自行扩展删除范围。已知 revision 可直接提交，不要求每次重新读取或先 dryRun。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function deleteCollection(
  id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const current = (await client.uns.metadataFind({ kind: 'collection', filter: { _id: id }, limit: 1 })).data.items[0];
  if (!current) throw new Error('集合不存在或不可见，未执行删除');
  const receipt = await client.uns.metadataDeleteOne({
    kind: 'collection', filter: { _id: id }, expectedRevision: current.revision,
    dryRun: false, idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.deletedCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  const deleted = await client.uns.metadataFind({ kind: 'collection', filter: { _id: id }, state: 'deleted', limit: 1 });
  if (!deleted.data.items[0]) throw new Error('删除有回执，但删除状态读回未确认');
  return { state: 'deleted' as const, receipt, deleted: deleted.data.items[0] };
}
```

metadataDeleteMany 使用明确 filter 和 maxDocs。默认原子；超过上限整体拒绝，不会静默只删第一批。批量删除前可 dryRun。state 默认 active，删除对象通过 state=deleted 查询；all 同时包含两种状态。

业务记录使用 recordDeleteOne/Many，传 collectionId 和明确 filter，编辑型流程同时传 expectedRevision。不要把元数据软删除解释成逐条删除该集合的 Record。Sample 的删除是独立的显式时间范围操作，具体影响遵循当前数据 API 契约。

恢复见[恢复](restore.md)。未知写入结果保留原意图键，先按对象身份核对，不自动换键重试。

## 永久删除回收站集合

Workspace 管理调用方使用 `metadataPurge`，传 `kind:'collection'` 和 1–200 个明确 `ids`。
只允许回收站集合；清空时先查全分页并固定这次选中的 ID，再按批调用同一个接口。
不另传 `force`、`cascade`、确认 token，也不要求先清空记录或执行 dryRun。
运行时 App 凭证不开放此操作；权限由后端统一校验。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function purgeCollections(
  ids: string[], intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.metadataPurge({
    kind: 'collection', ids, idempotencyKey: intentKey,
  });
  return { state: 'submitted' as const, receipt };
}
```

`status:accepted` 和 `jobId` 表示已受理，不表示已永久删除。通过 `client.uns.jobs`
查询任务并检查终态和逐项结果；部分失败不能报告整批成功，中断后继续查询原任务或复用原意图键。
永久删除包括全部 Record、Sample、集合元数据、索引以及指向集合的 App 授权；不连带删除 Topic、Source、Stream。
清理开始后不能恢复。索引由后台回收，不能仅凭已受理或数据清理回执声称物理空间已全部释放。
可选 `dryRun:true` 只返回校验结果，不创建清理任务。
