# 恢复集合与记录

metadataRestore 使用 kind、items:[{id,expectedRevision?}]。最近回收列表已有 revision 时直接使用；需要读取回收定义时用 metadataFind state:'deleted'。恢复重新检查名称、父目录、Schema、引用和唯一约束，冲突导致原子批次回滚。

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function restoreCollection(id: string, revision: UnsV2Integer, intentKey: string, client: Tier0Client = createClient()) {
  return client.uns.metadataRestore({
    kind: 'collection', items: [{ id, expectedRevision: revision }], idempotencyKey: intentKey,
  });
}

export async function restoreRecord(collectionId: string, id: string, intentKey: string, client: Tier0Client = createClient()) {
  return client.uns.recordRestore({ collectionId, ids: [id], dryRun: false, idempotencyKey: intentKey });
}
```

目录恢复同次回收的子树，之前独立回收对象不恢复。随目录/App 回收的对象通过原目录/App 恢复，分别可能报 DIRECTORY_IN_TRASH/OWNER_APP_TRASHED，不能据此自动补建。

通用元数据 restore 不补回已撤销授权；App appCollectionsRestore 恢复最近归档的 alias 并重新授权。alias 已被活动集合占用、父目录不可用或唯一键冲突需先解决。当前归档不逐条重写记录，旧 recordsArchivedAt 墓碑恢复仍可能受返回的限额约束。

Record restore 最多 100 个 ID，校验当前 Schema 和唯一键；此前独立删除的 Record 不随集合恢复，已被物理删除的 Sample 不恢复。insert/upsert 同 ID 不会隐式恢复。

检查 committed、restoredCount/restoredIds；需要最新快照时再读取。unknown 保留原键并核对原对象，不盲目重试，见 [数据工作流](data-workflows.md)。
