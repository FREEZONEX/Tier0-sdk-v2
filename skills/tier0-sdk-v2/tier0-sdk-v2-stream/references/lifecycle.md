# Stream 样例测试与流程衔接

创建并发布时，将 [创建](create.md) 或 [修改](update.md) 回执中的草稿直接交给 [发布](deploy.md)，再用发布回执的 activeRelease [观察运行](read.md#观察本次发布)，无需在发布前后各 get 一次。只有缺少当前草稿、处理版本冲突或需要最新状态时才 [查询](read.md)。停用、回滚和 [删除](delete.md) 按任务选择，不自动执行整套生命周期。

## 原生文档样例测试

方法：stream.sampleTest；输入 document、entryId、input。document 来自 documents.get 的完整草稿，entryId 必须在该文档注册的 entries 内。

```ts
import { createClient, type Tier0Client, type UnsV2JSONValue } from '@tier0/sdk-v2';

export async function testStreamSample(
  id: string, entryId: string, input: UnsV2JSONValue, client: Tier0Client = createClient(),
) {
  const { data: current } = await client.stream.documents.get({ id, view: 'full' });
  if (!('document' in current)) throw new Error('需要完整 Stream 文档');
  if (!current.document.entries?.some(entry => entry.id === entryId)) throw new Error('入口不在草稿中');
  const response = await client.stream.sampleTest({ document: current.document, entryId, input });
  return { status: response.data.status, errorCode: response.data.errorCode,
    writes: response.data.writePreview, logs: response.data.logs, mode: response.data.mode };
}
```

HTTP 成功也要检查 completed/failed 和 errorCode。模式为 isolated-sample，writePreview 不是线上写入；样例成功不能证明线上依赖健康。日志可能有业务数据，不直接公开。

所有 Source/Stream 接口返回完整 code/msg/requestId/data。预检、草稿保存、发布回执和真实运行应分别记录；不要以 SDK 本地测试通过宣称完成真实环境联调。
