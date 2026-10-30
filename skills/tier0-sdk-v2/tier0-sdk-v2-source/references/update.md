# 修改 Source

方法：`source.documents.update`；POST `/openapi/v2/uns/sources/documents/update`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 已知的 Source ID |
| patch / document | object / CloudSourceDocument | 二选一 | patch 保留未提供的字段；document 完整替换 |
| expectedRevision | integer | 是 | 已读取或上次提交返回的 revision，原样传回 |
| confirmedImpactRevision | string | 有引用时 | 相同修改意图和修订的 impact 回执 |
| dryRun | boolean | 否 | 默认 false 提交；true 仅预检 |
| idempotencyKey | string | 否 | 最多 128 字符 |

## 示例：一次请求修改名称

已有 ID 和 revision 时直接提交 patch。服务端在同一事务和依赖锁下检查引用并修改：没有任何草稿、活动或历史 Stream 引用时无需 impact。patch 中未提供的字段保留原值，config 如果提供则整体替换；完整 document 更新需先取得完整文档并保留未改配置和认证引用。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function renameSource(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const saved = await client.source.documents.update({
    id, expectedRevision, patch: { name }, dryRun: false, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未收到更新提交结果');
  return { receipt: saved, current: saved.data };
}
```

提交直接返回完整 Source view 和新的 revision，无需额外 get。版本冲突时不会覆盖其他人的修改。返回 `SOURCE_IMPACT_CONFIRMATION_REQUIRED` 表示存在引用且未提交，进入下面的显式评估流程；不要自动获取并同意影响。

## 有引用时：评估后确认相同意图

prepare 收集全部影响分页。在已有授权范围内评估 counts、restrictedCount 和引用后，再调用 commit。不可见引用也要求确认。影响字段说明见[影响分析](changes.md)。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function prepareSourceRename(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  name: string, client: Tier0Client = createClient(),
) {
  const intent: UnsV2Request<'sourceImpact'> = {
    id, expectedRevision, action: 'update', patch: { name },
  };
  const impact = await client.source.impact({ ...intent, offset: 0, size: 200 });
  const references = [...impact.data.references];
  let offset = impact.data.nextOffset;
  const seen = new Set<string>();
  while (String(offset) !== '0') {
    if (seen.has(String(offset))) throw new Error('影响分页未前进');
    seen.add(String(offset));
    const next = await client.source.impact({
      ...intent, offset, size: 200, impactRevision: impact.data.impactRevision,
    });
    if (next.data.impactRevision !== impact.data.impactRevision) throw new Error('影响确认值发生变化');
    references.push(...next.data.references);
    offset = next.data.nextOffset;
  }
  return { intent, impact: { ...impact.data, references, nextOffset: offset } };
}
export async function commitSourceRename(
  plan: { intent: UnsV2Request<'sourceImpact'>; impact: { impactRevision: string } },
  intentKey: string, client: Tier0Client = createClient(),
) {
  const { id, expectedRevision, patch, action } = plan.intent;
  if (action !== 'update' || !patch) throw new Error('需要修改意图');
  const saved = await client.source.documents.update({
    id, expectedRevision, patch, confirmedImpactRevision: plan.impact.impactRevision,
    dryRun: false, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未收到更新提交结果');
  return { receipt: saved, current: saved.data };
}
```

影响评估后的 plan 保持不变；已提供的确认回执始终严格校验，即使之后已无引用。修订冲突、确认过期或不匹配时重新读取并评估，不静默刷新回执重放。修改请求内容或补充确认回执属于新请求，应使用新幂等键；传输结果未知时保留原路由、请求和键，SDK 不自动重试。
