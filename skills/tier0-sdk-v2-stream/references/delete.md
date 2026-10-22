# 删除 Stream

方法：`stream.programs.delete`；POST `/openapi/v2/uns/streams/program/delete`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 十进制字符串 |
| expectedRevision | integer | 建议提供 | 当前 get 返回修订 |
| dryRun | boolean | 是 | true 预检；false 提交 |
| idempotencyKey | string | 否 | 最多 128 字符 |

先读取明确目标并评估活跃发布/调用依赖。停止运行与删除是两个操作，删除请求不自动授予对 Source/UNS 数据的清理权限。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function deleteStream(id: string, intentKey: string, client: Tier0Client = createClient()) {
  const { data: current } = await client.stream.documents.get({ id });
  const receipt = await client.stream.programs.delete({
    id, expectedRevision: current.revision, dryRun: false, idempotencyKey: intentKey,
  });
  if (!('deleted' in receipt.data) || receipt.data.deleted !== true) throw new Error('未确认删除');
  let page = 1;
  while (true) {
    const { data } = await client.stream.programs.list({ archived: true, page, size: 200 });
    const archived = data.list.find(item => item.id === id);
    if (archived) return { receipt, archived };
    if (!data.hasMore) return { receipt, archived: undefined };
    if (typeof data.nextPage !== 'number' || data.nextPage <= page) throw new Error('无有效下一页');
    page = data.nextPage;
  }
}
```

成功 data 为 `{id,revision,deleted:true}`；预检为 `{validated:true,sideEffects:false}`。归档列表额外核验，未查到时报告“删除有回执，读回未确认”。不要捕获所有 get 异常并返回删除成功。并发冲突重新评估，不用无版本保护的请求覆盖。
