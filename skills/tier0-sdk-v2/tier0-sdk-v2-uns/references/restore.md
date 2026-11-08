# 恢复元数据与记录

metadataRestore 接收 kind、items[{id,expectedRevision?}]。编辑流程复用回收列表中的 revision，没有版本时再用 state=deleted 读取。恢复由服务端校验名称、父目录、Schema 与引用，冲突时原子批次回滚。

恢复目录会一并恢复同次回收的子树，此前独立回收的对象保持原状态。随目录回收的子项应通过原目录恢复；单独恢复返回 CONDITION_FAILED / DIRECTORY_IN_TRASH。无需枚举子项逐个恢复；若请求同时列出父子项，服务端仍检查每项 expectedRevision。

随 App 回收的对象通过恢复原 App 处理，此前独立回收的对象保持原状态；OWNER_APP_TRASHED 不应触发重建或写入重试。通用元数据恢复不补回撤销的 grant；App 集合 restore 则恢复该 alias 最近归档的集合并重新授权。此前独立删除的记录不会随集合恢复。当前 archive / restore 不逐条重写记录；2000 条上限仅适用于旧 recordsArchivedAt 墓碑恢复。

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function restoreCollection(
  id: string, expectedRevision: UnsV2Integer,
  intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.metadataRestore({
    kind: 'collection', items: [{ id, expectedRevision }], idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.restoredCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt };
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
  return { state: 'committed' as const, receipt };
}
```

Record 恢复使用 recordRestore 的 ids（最多 100 条），重新校验当前 Schema 和有效唯一索引，冲突整批回滚。新增同 ID 或 upsert 不会隐式恢复对象。幂等键每个新意图独立；结果未知时核对原对象，正常成功无需额外读回。需要最新快照时，元数据恢复可使用回执 items，记录恢复可按需查询。
