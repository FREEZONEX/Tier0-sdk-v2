# 删除与回收

先区分目标：删除 Record、回收 Collection、精确清理 Sample 和永久删除集合具有不同保留语义。

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function deleteRecord(collectionId: string, id: string, revision: UnsV2Integer, intentKey: string, client: Tier0Client = createClient()) {
  return client.uns.recordDeleteOne({
    collectionId, filter: { _id: id }, expectedRevision: revision, idempotencyKey: intentKey,
  });
}
```

用最近读取或回执的 revision；无需固定先 dryRun 或重新读取。成功看 committed 和 deletedCount，需删除前快照时 returnDocument:'before'。Record 软删除会物理删除关联 Sample，恢复 Record 不恢复这些采样。

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function deleteCollection(id: string, revision: UnsV2Integer, intentKey: string, client: Tier0Client = createClient()) {
  return client.uns.metadataDeleteOne({
    kind: 'collection', filter: { _id: id }, expectedRevision: revision, idempotencyKey: intentKey,
  });
}
```

## 回收规则

metadataDeleteOne/Many 回收元数据。集合保留 Record、Sample 和查询索引，历史按既有未撤销授权只读，数据写入与 TTL 停止；索引继续占配额。

| 操作 | 范围 |
| --- | --- |
| 回收目录 | 同一事务回收有效子树；先前独立回收对象不加入本次批次 |
| 回收 Topic | 保留它引用的集合 |
| App 集合 archive | 回收该 alias 自有集合，撤销本 App grant；其他既有授权仍可读历史 |
| App 移入回收站 | 停用 App 并回收其自有集合和明确专属目录；借用集合与共享目录保留 |

外部引用不阻止集合回收，不连带删除引用方。metadataDeleteMany 使用明确 filter/maxDocs，超过上限整体拒绝；目录计数只计显式目标，子树由服务端处理。恢复规则见 [恢复](restore.md)。

## 精确删除历史样本

sampleDeleteExact 接收 collectionId 和从 sampleFind 读到的 `{recordId,id,time}` 清单，每批 1–200 条。需要 uns.delete，经 MCP 另需 uns.write；App 运行时不开放此操作。time 是原始发生时间的 Unix 毫秒，不能用 receivedAt 代替。

```ts
import { createClient, type Tier0Client, type UnsV2SampleDeleteExactReq } from '@tier0/sdk-v2';

export async function deleteSelectedSamples(collectionId: string, samples: UnsV2SampleDeleteExactReq['samples'], intentKey: string, dryRun = false, client: Tier0Client = createClient()) {
  return client.uns.sampleDeleteExact({ collectionId, samples, dryRun, idempotencyKey: intentKey });
}
```

不接受空/重复清单、filter 或范围。可选 dryRun:true 仅预览，返回 deletedCount/missingCount/dryRun；不改变父 Record 或其他样本。sampleDeleteRange 不向 MCP 开放，不能替代选中样本清理。未知结果按完整键核对，同意图保留原键。

## 永久删除回收站集合

metadataPurge 接收 kind:'collection'、1–200 个明确 ids 和 idempotencyKey，只处理回收集合；App 运行时不开放。清空回收站先查全分页并固定本次目标，再按批提交，不另传 force/cascade/确认 token。

accepted/jobId 只表示受理，使用 jobs 检查终态及逐项结果。永久清理全部 Record、Sample、集合定义、索引和 App 授权，不删除引用方；清理开始后不能恢复。可选 dryRun 只校验、不创建任务。不要只凭已受理声称数据或物理空间已全部释放。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function purgeCollections(ids: string[], intentKey: string, client: Tier0Client = createClient()) {
  return client.uns.metadataPurge({ kind: 'collection', ids, idempotencyKey: intentKey });
}
```
