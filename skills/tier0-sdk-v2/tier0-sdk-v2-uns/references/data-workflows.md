# UNS 分页、采样与写入恢复

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

消费方逐批处理以避免无限堆积内存；需要截止时用 AbortSignal。分页保证按返回游标继续，不保证跨请求保留相同行版本；导出审计要求一致快照时必须另行确认后端能力。

## 历史采样

```ts
import { createClient } from '@tier0/sdk-v2';

export async function readHistory(collectionId: string, recordId: string, from: number, to: number) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) {
    throw new Error('时间应为有效的 Unix 毫秒范围');
  }
  return createClient().uns.sampleFind({
    collectionId, recordIds: [recordId], from, to, limit: 200,
  });
}
```

返回可能分页；page 模式与 limit/cursor 互斥。Record 是业务实体，Sample 是该实体的时间序列，不用覆盖 Record 伪装保存历史。sampleDeleteRange 删除明确的时间范围，与删除 Record 的操作不可混淆。

## 写入、事务与恢复

```ts
import { createClient, UnsV2Error, UnsV2OutcomeUnknownError, type UnsV2JSONValue } from '@tier0/sdk-v2';

export async function insertRecord(collectionId: string, id: string, data: Record<string, UnsV2JSONValue>, intentKey: string) {
  try {
    return await createClient().uns.recordInsertOne({
      collectionId, id, data, dryRun: false, idempotencyKey: intentKey,
    });
  } catch (error) {
    if (error instanceof UnsV2OutcomeUnknownError) {
      return { state: 'unknown' as const, requestId: error.requestId, replaySafe: error.retry.safe };
    }
    if (error instanceof UnsV2Error) {
      return { state: 'rejected' as const, code: error.code, execution: error.execution, retry: error.retry };
    }
    throw error;
  }
}
```

该函数执行真实写入，仅用于已授权的新增意图。错误的 `execution` 说明执行到哪一步：`notStarted` / `rolledBack` 没有任何改动，`committed` 已生效，`unknown`（只出现在写入）可能已生效，此时抛出的是 `UnsV2OutcomeUnknownError`。`retry.safe` 表示可以用同一请求（同一幂等键）重发，`retry.afterMs` 是建议等待时间。`client.uns` 从不自动重试；unknown 时按指定 id 读取并核对业务内容，不能只凭记录存在就判定本次成功。

recordTransactionExecute 用 opId/dependsOn 表达依赖；不要拆成若干普通请求后声称具备事务性。allowPartial 适用于支持它的普通数组写入，事务不接受。部分成功检查每项结果，修正后的失败项是新的业务请求，不能原样重放整个批次。

recordLock 返回的 token 是租约凭据，更新/续租/解锁按原记录匹配；超时或租约失效不能继续假定持锁。只读响应中的 lock 状态不包含可用于写入的令牌。
