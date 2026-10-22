# 启用、停用 Source

方法：`source.state.update`；POST `/openapi/v2/uns/sources/state/update`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 是 | 提交 false |
| items[].id / expectedRevision | string / integer | 是 | 当前对象和修订 |
| items[].desiredState | enabled/disabled | 是 | 目标状态 |
| items[].confirmedImpactRevision | string | 是 | enable/disable 对应的影响回执 |
| mode / allowPartial | string / boolean | 否 | 单项示例 sync / false |
| idempotencyKey | string | 否 | 本次状态变更的独立意图键 |

先 get，以相同修订执行 impact(action=enable 或 disable)，按[影响分析](changes.md)遍历并评估。将原修订和回执传给下例。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function setSourceState(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  desiredState: 'enabled' | 'disabled', confirmedImpactRevision: string,
  intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.source.state.update({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, expectedRevision, desiredState, confirmedImpactRevision }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  const current = await client.source.documents.get({ id });
  if (current.data.desiredState !== desiredState) throw new Error('读回状态与目标不一致');
  return { state: 'committed' as const, receipt, current: current.data };
}
```

响应为 Outcome；accepted/jobId 仅表示受理，继续查询作业。enabled 是期望状态；健康与连通性另用 observations/runtime 检查。
