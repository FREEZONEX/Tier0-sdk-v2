# 删除 Source

方法：`source.documents.delete`；POST `/openapi/v2/uns/sources/documents/delete`。

传入单个 id、当前 expectedRevision、可选 dryRun（默认 false）与本次意图的 idempotencyKey。Source 本身必须先变为 disabled，仅停 Stream 不够。创建默认 enabled：先按[影响分析](changes.md)评估 action=disable，再调用 documents.state.update({id,expectedRevision,desiredState:'disabled',dryRun:false,...})；取得新 revision 后重新评估 action=delete。每一步只使用对应意图的 confirmedImpactRevision，不能复用 disable 的确认值删除。无依赖时可省确认值，不自动同意依赖影响。此接口不接受旧批量 items。

下方函数要求调用方已完成 Source 禁用，并提供最新 revision 与删除影响确认。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function deleteSource(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  intentKey: string, client: Tier0Client = createClient(), confirmedImpactRevision?: string,
) {
  const receipt = await client.source.documents.delete({
    id, expectedRevision, dryRun: false, idempotencyKey: intentKey,
    ...(confirmedImpactRevision === undefined ? {} : { confirmedImpactRevision }),
  });
  if (receipt.data.id !== id) return { state: 'unconfirmed' as const, receipt };
  return { state: 'archived' as const, receipt, archived: receipt.data };
}
```

提交返回 {id}；预检不删除。结果未知时先对账，保留原请求、requestId 和意图键，不自动重试；不能把任意 get 错误当成删除成功。
