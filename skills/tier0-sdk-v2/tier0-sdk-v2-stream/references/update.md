# 修改 Stream 草稿

`client.stream.documents.update` 接受 id、expectedRevision、互斥的 program/document、dryRun 和 idempotencyKey。使用创建/更新回执或 `documents.get({id,view:'full'})` 的完整草稿；summary 不含可回写脚本。

```ts
import { createClient, type Tier0Client, type CloudStreamDocumentView } from '@tier0/sdk-v2';

export async function updateStreamDescription(
  current: CloudStreamDocumentView, description: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  return client.stream.documents.update({
    id:current.id, expectedRevision:current.revision,
    document:{...current.document,description},dryRun:false,idempotencyKey:intentKey,
  });
}
```

编辑原生 document 时保留未修改的 script、sources 和 entries；以代码为主时可传 program 由服务端编译入口。保存本身会校验，仅需提前展示问题时单独 validate。

保存不改变生效版本，activeDocument 可能仍是旧发布。任务包含发布时使用返回的修订继续 [deploy](deploy.md)。VERSION_CONFLICT 后读取并比较当前草稿；未知结果先核对状态，同一意图恢复保留原键，不盲目覆盖。
