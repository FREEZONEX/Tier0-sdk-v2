# 修改 Source

方法：`source.documents.update`；POST `/openapi/v2/uns/sources/documents/update`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | get 返回的 ID |
| document | CloudSourceDocument | 是 | 完整新文档，保留未改字段和认证引用 |
| expectedRevision | integer | 是 | 读取时的 revision，原样传回 |
| confirmedImpactRevision | string | 是 | 相同文档和修订的 impact 回执 |
| dryRun | boolean | 是 | true 预检；false 提交 |
| idempotencyKey | string | 否 | 最多 128 字符 |

## 示例：修改名称并保留连接

prepare 读取文档、形成新文档并收集全部影响分页。在已有授权范围内评估 counts、restrictedCount 和引用后调用 commit，不自动串联未经授权的操作。影响字段说明见[影响分析](changes.md)。

```ts
import { createClient, type Tier0Client, type CloudSourceDocument, type UnsV2Request } from '@tier0/sdk-v2';

export async function prepareSourceRename(id: string, name: string, client: Tier0Client = createClient()) {
  const { data: current } = await client.source.documents.get({ id });
  const document: CloudSourceDocument = { ...current.document, name };
  const intent: UnsV2Request<'sourceImpact'> = {
    id, expectedRevision: current.revision, action: 'update', document,
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
  const { id, expectedRevision, document, action } = plan.intent;
  if (action !== 'update' || !document) throw new Error('需要完整更新意图');
  const request = { id, expectedRevision, document,
    confirmedImpactRevision: plan.impact.impactRevision };
  const preview = await client.source.documents.update({ ...request, dryRun: true });
  if (!('validated' in preview.data) || !preview.data.validated) throw new Error('预检未通过');
  const saved = await client.source.documents.update({
    ...request, dryRun: false, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未收到更新提交结果');
  return { receipt: saved, current: (await client.source.documents.get({ id })).data };
}
```

提交返回完整 Source view。核对读回名称、配置和提交修订；若读回又被别人修改，报告并发变化。影响评估后的 plan 保持不变。遇到 VERSION_CONFLICT、确认过期/不匹配，重新读取并评估，不静默刷新 token 重放。
