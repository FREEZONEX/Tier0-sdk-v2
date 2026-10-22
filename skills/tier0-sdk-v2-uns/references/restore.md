# 恢复集合与记录

| 方法 | 输入 | 返回 |
| --- | --- | --- |
| collectionRestore | dryRun、items[{id,expectedRevision}]、可选 mode/idempotencyKey | Outcome |
| recordRestore | collectionId、ids（1–100）、可选 dryRun/idempotencyKey | restoredCount、restoredIds、status、replayed |

集合 ID 和修订从 collectionList({archived:true,…}) 的实际归档项取得；不要使用归档前的旧修订。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function restoreCollection(
  id: string, expectedRevision: NonNullable<UnsV2Request<'collectionRestore'>['items'][number]['expectedRevision']>,
  intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.collectionRestore({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, expectedRevision }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt, current: (await client.uns.collectionGet({ id })).data };
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

Record 恢复重新校验当前 Schema 和有效唯一索引，冲突整批回滚；revision 递增。删除记录时关联 Sample 已物理删除，恢复不会重建历史。幂等键每个新意图独立，未知结果不要换键重试。
