# 删除 Source

方法：`source.delete`；POST `/openapi/v2/uns/sources/delete`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 是 | true 预检；false 提交 |
| items | array | 是 | 1–200 项 |
| items[].id | string | 是 | 正十进制 int64 字符串 |
| items[].expectedRevision | integer | 是 | 已知的当前修订 |
| items[].confirmedImpactRevision | string | 有引用时 | action=delete 的影响回执 |
| mode | auto/sync | 否 | 不支持 async |
| allowPartial | false | 否 | 不支持部分提交 |
| idempotencyKey | string | 否 | 最多 128 字符 |

Source 必须已停用。没有任何 Stream 引用时，直接用已有 ID 和 revision 提交；有引用时先 impact(action=delete) 并[遍历和评估影响](changes.md)，再显式传入回执。服务端在同一事务中检查依赖和修订，不自动删除或停用依赖流。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function deleteSource(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  intentKey: string, client: Tier0Client = createClient(), confirmedImpactRevision?: string,
) {
  const receipt = await client.source.delete({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, expectedRevision,
      ...(confirmedImpactRevision === undefined ? {} : { confirmedImpactRevision }) }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  const archived = receipt.data.results?.find(item => item.id === id && item.status === 'deleted');
  if (!archived) return { state: 'unconfirmed' as const, receipt };
  return { state: 'archived' as const, receipt, archived };
}
```

返回 Outcome，HTTP 200/validated/accepted 不等于完成。已提交回执中对应 ID 的 deleted 结果足以确认归档，无需遍历归档列表；不能把任意 get 异常当成成功。传输结果未知时保留原请求、requestId 和意图键，不自动重试。补充确认回执是新请求，应使用新幂等键。
