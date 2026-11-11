# 发布、停用与回滚

| SDK 方法 | 必要身份/版本参数 |
| --- | --- |
| `stream.programs.deploy` | id、expectedRevision、expectedActiveVersion |
| `stream.documents.disable` | id、expectedRevision、expectedActiveVersion |
| `stream.programs.rollback` | 同上，加 versions.list 中的 versionId |

以上操作使用当前 Stream 管理权限，分别携带自己的 idempotencyKey 和 dryRun:false。当前入口没有 documents.deploy。Source 的访问仍按真实绑定校验。

| 回执字段 | 含义 |
| --- | --- |
| revision | 草稿修订，传 expectedRevision |
| activeVersion | 不可变发布 ID 字符串，传 expectedActiveVersion；回滚目标使用其 versionId，不能推算 |
| activeRelease | 发布序号，用来匹配 runs[].release |

activeVersion 为 `"0"` 表示无活跃版本；program 回执此时省略 activeRelease，原生 document 视图可为 0。历史回执缺少 activeRelease 时保留缺口，不能用当前 head 冒充原发布号。

```ts
import { createClient, type Tier0Client, type CloudStreamDocumentView } from '@tier0/sdk-v2';

export async function deployStream(
  current: CloudStreamDocumentView, intentKey: string, client: Tier0Client = createClient(),
) {
  return client.stream.programs.deploy({
    id:current.id, expectedRevision:current.revision,expectedActiveVersion:current.activeVersion,
    dryRun:false,idempotencyKey:intentKey,
  });
}
```

检查发布回执具有非零 activeVersion，再以其 activeRelease [观察运行](read.md#观察本次发布)。不要把预检结果当发布。`expectedSourceRevision` 仅用于恰好一个 Source 依赖，并同时保护绑定修订和当前 Source head；多源不传一个合成修订。

停用和回滚同样使用手头权威快照的版本守卫。停用保留草稿；回滚使用明确历史 versionId。只有状态缺失或发生版本冲突时才重新读取，修改脚本本身不自动执行停用、回滚或删除。

创建与发布各自提交；保存成功而发布失败时修复已有草稿。超时或 UnsV2OutcomeUnknownError 后核对状态，恢复同一操作保留原路径、载荷和幂等键；不同键可能生成另一个发布。远端绑定预检失败也不能否定先前同键操作已经成功。
