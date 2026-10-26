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

元数据使用 metadataDeleteOne/Many，或 metadataDeleteOne + returnDocument:before 返回删除前对象。它们执行软删除，增加 revision，不隐式级联目录后代、引用对象或集合数据。引用约束与版本冲突必须处理，不能自行扩展删除范围。

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
