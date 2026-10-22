# 发布、停用与回滚 Stream

| 方法 | POST 路径 | 必要参数 |
| --- | --- | --- |
| programs.deploy | /openapi/v2/uns/streams/program/deploy | id、dryRun；建议 expectedRevision |
| programs.disable | /openapi/v2/uns/streams/program/disable | id、dryRun；建议 expectedRevision |
| programs.rollback | /openapi/v2/uns/streams/program/rollback | id、versionId、dryRun；建议 expectedRevision |
| documents.disable | /openapi/v2/uns/streams/documents/disable | id、expectedRevision、expectedActiveRelease、dryRun |

全部写操作使用各自的 idempotencyKey。expectedSourceRevision 只适用于恰好一个 Source 依赖，且同时保护草稿冻结修订与当前 Source head；多源不能塞入单个修订值。原生文档没有 documents.deploy，当前云端 program 模型发布走 programs.deploy。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function deployStream(id: string, intentKey: string, client: Tier0Client = createClient()) {
  const { data: current } = await client.stream.documents.get({ id });
  const sources = current.document.sources ?? [];
  const request = {
    id, expectedRevision: current.revision,
    ...(sources.length === 1 ? { expectedSourceRevision: sources[0]!.configRevision } : {}),
  };
  const receipt = await client.stream.programs.deploy({
    ...request, dryRun: false, idempotencyKey: intentKey,
  });
  if (typeof receipt.data.activeVersion !== 'string' || receipt.data.activeVersion === '0') {
    throw new Error('未确认发布版本');
  }
  return { receipt, current: (await client.stream.documents.get({ id })).data,
    observation: (await client.stream.observations.get({ id })).data };
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

发布成功不表示外部连接健康或每次执行成功；检查 observation 与执行记录。停用保留草稿。仅修改草稿的任务不额外发布/停用。

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

检查回执 activeVersion，并重新 get/observation。超时或 UnsV2OutcomeUnknownError 时先核对版本和观测，保留原请求意图键，不重复 deploy/rollback。预览用 dryRun=true，但不保证稍后的实际发布一定成功。
