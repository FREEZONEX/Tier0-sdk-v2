# 查询 Stream

| 方法 | POST 路径 | 输入 | 结果 |
| --- | --- | --- | --- |
| programs.list | /openapi/v2/uns/streams/program/list | page、size、search、sourceId、model、status、archived | list、total、hasMore、nextPage |
| programs.get | /openapi/v2/uns/streams/program/get | id | 运行摘要，document 已脱敏 |
| documents.get | /openapi/v2/uns/streams/documents/get | id | 完整草稿、revision、status、activeRelease、可选 activeDocument |
| observations.get | /openapi/v2/uns/streams/observation/get | id | 运行观测 |
| runs.list | /openapi/v2/uns/streams/runs/list | id、size、cursor | 执行记录 |
| programs.versions.list | /openapi/v2/uns/streams/program/versions/list | id、page、size | list、total，含 versionId |

page 从 1 开始，size 最大 200。完整文档需要 Stream manage 权限；programs.get 的 scriptConfigured 不是脚本内容，不能据此重建草稿。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function readStream(id: string, client: Tier0Client = createClient()) {
  const draft = await client.stream.documents.get({ id });
  const summary = await client.stream.programs.get({ id });
  const observation = await client.stream.observations.get({ id });
  return { draft: draft.data, summary: summary.data, observation: observation.data };
}
export async function* listStreams(client: Tier0Client = createClient()) {
  let page = 1;
  while (true) {
    const { data } = await client.stream.programs.list({ page, size: 100, archived: false });
    yield data.list;
    if (!data.hasMore) return;
    if (typeof data.nextPage !== 'number' || data.nextPage <= page) throw new Error('无有效下一页');
    page = data.nextPage;
  }
}
```

保存、发布、某次执行成功是三个事实。显示实际 revision/activeVersion/release，不用旧 runs 证明新版本生效。版本列表不保证与普通列表相同分页结构；按其 list/total/page/size 读取，versionId 不是 release 序号。
