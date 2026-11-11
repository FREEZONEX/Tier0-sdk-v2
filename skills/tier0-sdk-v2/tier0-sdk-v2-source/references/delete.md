# 删除 Source

`client.source.documents.delete` 接受单个 id、当前 expectedRevision、dryRun（默认 false）、幂等键及必要的 confirmedImpactRevision。

无依赖时可直接提交；存在依赖或服务端要求确认时按[影响分析](changes.md)评估 `action:'delete'`，不携带 patch/document。只有执行目标明确要求 Source disabled 时才先按其状态接口处理；不要固定为所有部署增加停用步骤。状态变更与删除各自使用对应修订和确认值。

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
  if (receipt.data.id !== id) throw new Error('Unexpected Source deletion receipt');
  return receipt;
}
```

提交返回删除回执，预检不删除。结果未知先对账，保留原请求、requestId 和幂等键。任意 get 失败不能证明删除成功；Source 删除也不等于删除已保存的业务数据。
