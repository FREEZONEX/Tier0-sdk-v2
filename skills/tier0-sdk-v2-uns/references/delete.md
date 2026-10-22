# 删除记录与归档集合

集合没有 collectionDelete；使用 collectionArchive。记录使用 recordDeleteOne/Many。两种操作的影响不可互换。

## 删除一个明确 ID 的记录

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| collectionId | string | 是 | 所属集合 |
| filter | object | 是 | 示例用 _id 精确等值 |
| expectedRevision | integer | 建议提供 | 刚读取的记录修订 |
| dryRun | boolean | 否 | 默认 false，示例显式指定 |
| idempotencyKey | string | 否 | 最多 96 字符 |

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function deleteDevice(
  collectionId: string, id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const found = await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 });
  const current = found.data.items[0];
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

删除 Record 时关联 Sample 被物理删除；恢复记录不会重建这些 Sample。批量删除先明确筛选范围，不能用空 filter 代替未知 ID。删除回执含 deletedCount/status/replayed。

## 归档集合

输入 dryRun、items[{id,expectedRevision}]，可选 mode/allowPartial/idempotencyKey（最多128字符）。归档不等于逐条删除 Record，也不承诺物理擦除。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function archiveCollection(
  id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const { data: current } = await client.uns.collectionGet({ id });
  const receipt = await client.uns.collectionArchive({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, expectedRevision: current.revision }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  let page = 1;
  while (true) {
    const { data } = await client.uns.collectionList({ archived: true, page, size: 200 });
    const archived = data.list.find(item => item.id === id);
    if (archived) return { state: 'archived' as const, receipt, archived };
    if (!data.hasMore) return { state: 'committed-readback-unconfirmed' as const, receipt };
    if (typeof data.nextPage !== 'number' || data.nextPage <= page) throw new Error('无有效下一页');
    page = data.nextPage;
  }
}
```

返回 Outcome，accepted 需要 jobs 对账；不能提前宣称完成。引用约束或版本冲突应停止并评估，不自动连带删除 Topic/Source/Stream。恢复见[恢复](restore.md)。
