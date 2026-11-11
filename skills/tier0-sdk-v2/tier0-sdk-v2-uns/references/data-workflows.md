# 分页、Sample 与写入恢复

## 完整游标遍历

```ts
import { createClient } from '@tier0/sdk-v2';

export async function* scanRecords(collectionId: string, signal?: AbortSignal) {
  const client = createClient();
  let cursor: string | undefined;
  const seen = new Set<string>();
  while (true) {
    const { data } = await client.uns.recordFind({ collectionId, limit: 200, cursor }, { signal });
    yield data.items;
    if (!data.pageInfo.hasMore) return;
    const next = data.pageInfo.nextCursor;
    if (!next || seen.has(next)) throw new Error('服务端未返回可继续的游标');
    seen.add(next);
    cursor = next;
  }
}
```

逐批消费避免全量堆积。跨请求分页不是固定快照；同页多项读取的一致性用 queryBatch。

## 历史采样

Record 是实体，Sample 是它的时序值。sampleFind/aggregate 使用 collectionId、可选 recordIds（最多 20）、必填 from/to，Unix 毫秒区间 `[from,to)`；page 与 limit/cursor 互斥。分页覆盖所有选中记录，latest 无采样返回 null。

```ts
import { createClient } from '@tier0/sdk-v2';

export async function readHistory(collectionId: string, recordId: string, from: number, to: number) {
  return createClient().uns.sampleFind({ collectionId, recordIds: [recordId], from, to, limit: 200 });
}
```

追加使用 sampleAppend 的记录目标和 items:[{time,data,...}]，显式 dryRun；time 是发生时间，receivedAt 由服务端生成。不要通过覆盖 Record 保存历史。清理选定样本见 [精确删除](delete.md#精确删除历史样本)。

## 写入、事务与恢复

client.uns 不自动重试。每个写入意图用独立 idempotencyKey，同请求重试保留原键；dryRun 仅校验，accepted/jobId 仅表示任务受理。App 运行时不支持异步任务。

| execution | 含义 |
| --- | --- |
| notStarted / rolledBack | 没有提交 |
| committed | 已提交，非原子批次可能部分完成 |
| unknown | 无法证明是否提交；抛 UnsV2OutcomeUnknownError |

unknown 先按稳定 ID 与业务内容核对，不能仅凭存在确认成功。retry.safe 才能原样重发，遵守 afterMs；取消请求不撤销写入。

recordTransactionExecute 用 opId/dependsOn 表达依赖，全部成功或回滚；普通请求拆开不构成事务。Record 事务不接受 Sample 动作。允许部分成功的写入检查逐项结果；updateMany/deleteMany 根据 resumeAfter 续做，bulkWrite 看 nextIndex/unknownUntil，不能整体重跑已提交的增量更新。

记录租约仅用于确需独占编辑的流程。recordLock 的 token 供写入、续租和解锁使用；只读锁状态不含令牌，过期后不再假定持锁。普通并发编辑用 expectedRevision 即可。
