# 查询 Stream

| 方法 | POST 路径 | 输入 | 结果 |
| --- | --- | --- | --- |
| programs.list | /openapi/v2/uns/streams/program/list | page、size、search、sourceId、model、status、archived | list、total、hasMore、nextPage |
| documents.get | /openapi/v2/uns/streams/documents/get | id；可选 view:summary/full | summary 返回摘要；full 返回完整草稿、revision、status、activeRelease、可选 activeDocument |
| observations.get | /openapi/v2/uns/streams/observation/get | id | 运行观测 |
| runs.list | /openapi/v2/uns/streams/runs/list | id、size、cursor | 执行记录 |
| programs.versions.list | /openapi/v2/uns/streams/program/versions/list | id、page、size | list、total，含 versionId |

page 从 1 开始，size 最大 200。summary 只需 uns.stream.view 或 uns.stream.manage；full 或省略 view 需要 uns.stream.manage，API Key 还必须是 full_access。摘要不含脚本，不能据此重建草稿。已有创建或更新回执时可复用其文档与 revision，不必再读取。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function readStream(id: string, client: Tier0Client = createClient()) {
  const draft = await client.stream.documents.get({ id });
  const observation = await client.stream.observations.get({ id });
  return { draft: draft.data, observation: observation.data };
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

## 观察本次发布

把 deploy 回执的 activeRelease 原样传入，不需要先读取当前 head。runs.list 需要 uns.stream.view 或 uns.stream.manage；它没有服务端 release 过滤参数，按返回的 nextCursor 继续翻页并在客户端匹配发布号：

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function readPublishedRuns(
  id: string, release: UnsV2Integer, cursor?: string,
  client: Tier0Client = createClient(),
) {
  if (typeof release === 'number' && !Number.isSafeInteger(release)) {
    throw new Error('发布号必须保留回执中的精确整数，不能传已失真的 number');
  }
  if (BigInt(String(release)) <= 0n) throw new Error('需要发布回执中的正整数发布号');
  const { data } = await client.stream.runs.list({ id, size: 100, ...(cursor ? { cursor } : {}) });
  return { ...data, items: data.items.filter(run => run.release === String(release)) };
}
```

此函数只读一页。items 为空但 nextCursor 非空时，下一页仍可能有匹配记录；达到调用方的观察时限就报告“尚未观察到”。匹配记录也要检查 status、entryId 和时间，不能把存在记录当成执行成功。历史幂等回执若缺少 activeRelease，应保留为未确认，不能用当前 head 的发布号代替。

失败或结果未知的运行可带 `error:{code,stage,message,repair,sourceRequest?}` 安全诊断。`SOURCE_TARGET_SCOPE_MISMATCH`、`stage:validate_binding` 表示请求超出 Source 凭据范围，应检查绑定基址与实际 method/path/query，保留原授权限制。`sourceRequest:notDispatched` 只证明失败的这一次 Source 请求未发送，不能推断整个 Stream 未开始或此前没有写入。

`EXECUTION_FAILED` 和 `RESULT_UNKNOWN` 是安全通用诊断，分别保留失败和结果未知的区别。按 code/stage 判断，展示服务端 message/repair；没有 error 的旧记录仍按 status 解释，不补造原因，也不因可重试猜测而自动重新执行。运行诊断不包含 token、凭据引用或完整请求 URL。

支持 HTTP 响应诊断的后端还会保留 `SOURCE_HTTP_<三位状态码>`（300–599）、`stage:source_response`，例如 `SOURCE_HTTP_401`。这是可信宿主在本轮观察到的非 2xx 响应；不是脚本错误文案，也不证明它是所有后续失败的唯一原因。`status:unknown` 可以同时带此诊断：已知上游返回 401，不等于整轮外部副作用已确定或可以安全重试。只读查询 runs 的 HTTP 200 也不等于采集成功。运行最终成功时不会附加此前已被脚本处理的 HTTP 错误。
