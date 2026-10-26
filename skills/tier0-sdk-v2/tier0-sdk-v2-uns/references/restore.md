# 恢复元数据与记录

metadataRestore 接收 kind、items[{id,expectedRevision?}]，支持一个或多个明确 ID。revision 应从 state=deleted 的当前对象读取。恢复重新校验名称、父目录、Schema 与引用；不会恢复其他对象，冲突时原子批次回滚。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function restoreCollection(
  id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const deleted = (await client.uns.metadataFind({ kind: 'collection', filter: { _id: id }, state: 'deleted', limit: 1 })).data.items[0];
  if (!deleted) throw new Error('未找到待恢复集合');
  const receipt = await client.uns.metadataRestore({
    kind: 'collection', items: [{ id, expectedRevision: deleted.revision }], idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.restoredCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  const current = (await client.uns.metadataFind({ kind: 'collection', filter: { _id: id }, limit: 1 })).data.items[0];
  if (!current) throw new Error('恢复有回执，读回未确认');
  return { state: 'committed' as const, receipt, current };
}

export async function restoreDevice(
  collectionId: string, id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.recordRestore({
    collectionId, ids: [id], dryRun: false, idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || !receipt.data.restoredIds.includes(id)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  const found = await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 });
  if (!found.data.items[0]) throw new Error('恢复有回执，读回未确认');
  return { state: 'committed' as const, receipt, current: found.data.items[0] };
}
```

Record 恢复使用 recordRestore 的 ids（最多 100 条），重新校验当前 Schema 和有效唯一索引，冲突整批回滚。新增同 ID 或 upsert 不会隐式恢复对象。幂等键每个新意图独立。
