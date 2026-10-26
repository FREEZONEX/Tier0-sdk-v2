# Stream 样例测试与流程衔接

完整流程按任务选取：[创建](create.md) → [查询](read.md) → [修改](update.md) → [发布/停用/回滚](deploy.md) → [删除](delete.md)。不要为了完成一次查询自动执行整套流程。

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
