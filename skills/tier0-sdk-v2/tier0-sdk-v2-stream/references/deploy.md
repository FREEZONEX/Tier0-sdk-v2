# 发布、停用与回滚 Stream

| 方法 | POST 路径 | 必要参数 |
| --- | --- | --- |
| programs.deploy | /openapi/v2/uns/streams/program/deploy | id、dryRun；建议 expectedRevision |
| programs.disable | /openapi/v2/uns/streams/program/disable | id、dryRun；建议 expectedRevision |
| programs.rollback | /openapi/v2/uns/streams/program/rollback | id、versionId、dryRun；建议 expectedRevision |
| documents.disable | /openapi/v2/uns/streams/documents/disable | id、expectedRevision、expectedActiveRelease、dryRun |

全部写操作使用各自的 idempotencyKey。expectedSourceRevision 只适用于恰好一个 Source 依赖，且同时保护草稿冻结修订与当前 Source head；多源不能塞入单个修订值。原生文档没有 documents.deploy，当前云端 program 模型发布走 programs.deploy。

发布、停用和回滚需要 uns.stream.manage；相关 Source 访问还受各自授权约束。保存回执中的 revision、发布回执中的 activeVersion 与 activeRelease 分别用于不同目的：

| 字段 | 含义与用途 |
| --- | --- |
| revision | 草稿修订；传给下次写入的 expectedRevision，冲突时显式处理 |
| activeVersion | 不可变发布版本 ID；回滚的 versionId 使用这个 ID，不使用发布序号 |
| activeRelease | 本次事务记录的正整数发布序号；与 runs.list 中的 release 对照；无活跃发布或旧回执未记录时省略 |

programs 的旧 activeVersion:'0' 约定保持兼容；新增 activeRelease 不用 0 表示未发布。原生 documents 回执的既有 activeRelease 约定不变。

```ts
import { createClient, type Tier0Client, type CloudStreamDocumentView } from '@tier0/sdk-v2';

export async function deployStream(current: CloudStreamDocumentView, intentKey: string, client: Tier0Client = createClient()) {
  const sources = current.document.sources ?? [];
  const request = {
    id: current.id, expectedRevision: current.revision,
    ...(sources.length === 1 ? { expectedSourceRevision: sources[0]!.configRevision } : {}),
  };
  const receipt = await client.stream.programs.deploy({
    ...request, dryRun: false, idempotencyKey: intentKey,
  });
  if (!('id' in receipt.data) || receipt.data.activeVersion === '0') {
    throw new Error('未确认发布版本');
  }
  const release = receipt.data.activeRelease;
  if (release === undefined || BigInt(String(release)) <= 0n) {
    throw new Error('历史回执缺少发布编号；保留原请求，不用当前发布编号替代');
  }
  return { receipt, release };
}

export async function disableStream(id: string, intentKey: string, client: Tier0Client = createClient()) {
  const { data: current } = await client.stream.documents.get({ id });
  if (String(current.activeRelease) === '0') throw new Error('没有活跃发布可停用');
  const receipt = await client.stream.documents.disable({
    id, expectedRevision: current.revision, expectedActiveRelease: current.activeRelease,
    dryRun: false, idempotencyKey: intentKey,
  });
  const after = await client.stream.documents.get({ id });
  if (String(after.data.activeRelease) !== '0') throw new Error('停用读回未确认');
  return { receipt, current: after.data };
}
```

将创建或更新回执的 current 传给 deployStream，只发一次发布请求。只有手上没有草稿快照时才先 documents.get。使用 [按发布号查询运行记录](read.md#观察本次发布) 才能观察这次发布，观察窗口汇总不能证明该版本运行。发布成功不表示外部连接健康或执行成功。停用保留草稿。仅修改草稿的任务不额外发布/停用。

## 回滚到明确版本

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function rollbackStream(
  id: string, versionId: string, intentKey: string, client: Tier0Client = createClient(),
) {
  // versionId 必须先从 programs.versions.list({id,page,size}) 查询并选定。
  const { data: current } = await client.stream.documents.get({ id });
  return client.stream.programs.rollback({
    id, versionId, expectedRevision: current.revision, dryRun: false, idempotencyKey: intentKey,
  });
}
```

检查回执 activeVersion 与 activeRelease。超时或 UnsV2OutcomeUnknownError 时保留原路由、载荷和幂等键；允许恢复时原样重发以取得原回执，不用新键再次发布。旧回执可能没有 activeRelease，不能读取当前 head 后冒充旧请求的发布编号。相同草稿使用不同键仍会创建新发布，expectedRevision 仅保护草稿修订。预览用 dryRun=true，返回 validated/sideEffects，不保证稍后的实际发布一定成功。
