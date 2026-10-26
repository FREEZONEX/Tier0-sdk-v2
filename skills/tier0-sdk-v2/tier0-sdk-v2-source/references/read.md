# 查询 Source

| 方法 | POST 路径 | 输入 | data |
| --- | --- | --- | --- |
| source.documents.list | /openapi/v2/uns/sources/documents/list | page、size、search、protocol、desiredState、health、archived、includeDocument | list、total、page、hasMore、nextPage |
| source.documents.get | /openapi/v2/uns/sources/documents/get | id（必填）、view:'summary' 或 'full' | id、revision、状态；full 才包含完整 document |
| source.runtime.get | /openapi/v2/uns/sources/runtime/get | id（必填） | 运行状态 |
| source.observations.get | /openapi/v2/uns/sources/observations/get | items：id、expectedRevision | 指定源和修订的观测 |

page 从 1 开始，size 1–200。列表默认安全摘要。get 省略 view 保持旧的 full 行为；summary 需要 uns.source.view 或 uns.source.manage，full 需要 uns.source.manage。未知 revision 时可读取 summary；要完整替换 document 或查看配置时读取 full。已持有写回执中的 ID/revision 时，可直接提交 patch，无需为了编辑再 get；服务端仍会检查版本冲突。摘要不能用于重建完整配置。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function* listSources(client: Tier0Client = createClient()) {
  let page = 1;
  while (true) {
    const { data } = await client.source.documents.list({ page, size: 100, includeDocument: false });
    yield data.list;
    if (!data.hasMore) return;
    if (typeof data.nextPage !== 'number' || data.nextPage <= page) throw new Error('无有效下一页');
    page = data.nextPage;
  }
}
export async function readSource(id: string, client: Tier0Client = createClient()) {
  const current = await client.source.documents.get({ id });
  const observation = await client.source.observations.get({
    items: [{ id, expectedRevision: current.data.revision }],
  });
  return { current: current.data, observation: observation.data };
}
```

ID 不得转 Number；跨页不是稳定快照。权限错误、网络故障与不存在应分别处理，不能把任何 get 失败当成删除成功。probe 可能触达外部系统，不属于单纯读取。
