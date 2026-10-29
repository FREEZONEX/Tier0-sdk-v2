# 删除 Stream

方法：`stream.programs.delete`；POST `/openapi/v2/uns/streams/program/delete`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 十进制字符串 |
| expectedRevision | integer | 建议提供 | 当前回执或查询的修订 |
| dryRun | boolean | 是 | true 预检；false 提交 |
| idempotencyKey | string | 否 | 最多 128 字符 |

使用已确认目标的回执或查询快照，评估活跃发布/调用依赖。停止运行与删除是两个操作，删除请求不自动授予对 Source/UNS 数据的清理权限。

```ts
import { createClient, type Tier0Client, type CloudStreamStopView } from '@tier0/sdk-v2';

export async function deleteStream(
  current: Pick<CloudStreamStopView, 'id' | 'revision'>, intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.stream.programs.delete({
    id: current.id, expectedRevision: current.revision, dryRun: false, idempotencyKey: intentKey,
  });
  if (!('deleted' in receipt.data) || receipt.data.deleted !== true) throw new Error('未确认删除');
  return { receipt, current: receipt.data };
}
```

成功 data 为 `{id,revision,deleted:true}`；预检为 `{validated:true,sideEffects:false}`。默认以 deleted 回执确认本次删除，无需遍历归档列表。需要独立审计时再按页查询 programs.list({archived:true,page,size})，找不到不能伪造读回确认。不要捕获所有 get 异常并返回删除成功。并发冲突重新评估，不用无版本保护的请求覆盖。
