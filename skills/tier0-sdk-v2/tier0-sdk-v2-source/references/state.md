# 启用、停用 Source

方法：`source.state.update`；POST `/openapi/v2/uns/sources/state/update`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 否 | 默认 false 提交；true 仅预检 |
| items[].id / expectedRevision | string / integer | 是 | 当前对象和已知修订 |
| items[].desiredState | enabled/disabled | 是 | 目标状态 |
| items[].confirmedImpactRevision | string | 有引用时 | enable/disable 对应的影响回执 |
| mode / allowPartial | string / boolean | 否 | 单项示例 sync / false |
| idempotencyKey | string | 否 | 本次状态变更的独立意图键 |

没有任何 Stream 引用时，一次请求即可提交期望状态。有引用时先以相同修订执行 impact(action=enable 或 disable)，按[影响分析](changes.md)遍历并评估，再显式传入回执。服务端在同一事务中检查引用和修订，不会因未传回执而自动同意影响。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function setSourceState(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  desiredState: 'enabled' | 'disabled', intentKey: string,
  client: Tier0Client = createClient(), confirmedImpactRevision?: string,
) {
  const receipt = await client.source.state.update({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, expectedRevision, desiredState,
      ...(confirmedImpactRevision === undefined ? {} : { confirmedImpactRevision }) }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt };
}
```

响应为 Outcome；committed 且无项错误即可确认期望状态已提交，无需额外 get。accepted/jobId 仅表示受理，继续查询作业。enabled 是期望状态；健康与连通性另用 observations/runtime 检查。提供的回执始终严格校验，确认过期或依赖变化不能自动刷新同意。
