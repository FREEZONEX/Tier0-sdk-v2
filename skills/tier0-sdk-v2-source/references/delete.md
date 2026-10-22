# 删除 Source

方法：`source.delete`；POST `/openapi/v2/uns/sources/delete`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 是 | true 预检；false 提交 |
| items | array | 是 | 1–200 项 |
| items[].id | string | 是 | 正十进制 int64 字符串 |
| items[].expectedRevision | integer | 是 | get 返回的修订 |
| items[].confirmedImpactRevision | string | 是 | action=delete 的影响回执 |
| mode | auto/sync | 否 | 不支持 async |
| allowPartial | false | 否 | 不支持部分提交 |
| idempotencyKey | string | 否 | 最多 128 字符 |

先 get → impact(action=delete) → [遍历并评估影响](changes.md)。存在 Stream 依赖时遵守服务端保护，不自动删除依赖流。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function deleteSource(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  confirmedImpactRevision: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.source.delete({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, expectedRevision, confirmedImpactRevision }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  let page = 1;
  while (true) {
    const { data } = await client.source.documents.list({
      archived: true, page, size: 200, includeDocument: false,
    });
    const archived = data.list.find(item => item.id === id);
    if (archived) return { state: 'archived' as const, receipt, archived };
    if (!data.hasMore) break;
    if (typeof data.nextPage !== 'number' || data.nextPage <= page) throw new Error('无有效下一页');
    page = data.nextPage;
  }
  return { state: 'committed-readback-unconfirmed' as const, receipt };
}
```

返回 Outcome，HTTP 200/validated/accepted 不等于完成。归档列表找到 ID 是额外核验；读回不可见时保留提交回执，报告核验未完成。不能把任意 get 异常当成成功。
