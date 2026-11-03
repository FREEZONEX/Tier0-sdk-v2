# 恢复元数据与记录

metadataRestore 接收 kind、items[{id,expectedRevision?}]，支持一个或多个明确 ID。revision 应从 state=deleted 的当前对象读取。恢复重新校验名称、父目录、Schema 与引用，冲突时原子批次回滚。

恢复目录只恢复随该目录同一次删除的子树，此前独立回收的对象保持原状态。随目录回收的子项不能单独恢复，应恢复原目录；否则返回 CONDITION_FAILED，data.reason 为 DIRECTORY_IN_TRASH。批次同时选择根目录和其子项时，服务端先校验每项 expectedRevision，再执行一次级联恢复。

随 App 回收的自有集合与专属目录须通过恢复原 App 处理；原本已独立回收的对象不会随 App 恢复。OWNER_APP_TRASHED 表示所属 App 仍在回收站，应恢复 App，不要原样重试写入或单独恢复集合。恢复不扩大授权，通用元数据恢复也不自动补回已撤销的 App grant。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function restoreCollection(
  id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const deleted = (await client.uns.metadataFindOne({ kind: 'collection', filter: { _id: id }, state: 'deleted' })).data.value;
  if (!deleted) throw new Error('未找到待恢复集合');
  const receipt = await client.uns.metadataRestore({
    kind: 'collection', items: [{ id, expectedRevision: deleted.revision }], idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.restoredCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  const current = (await client.uns.metadataFindOne({ kind: 'collection', filter: { _id: id } })).data.value;
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
