# 删除记录与元数据

记录删除使用专属数据接口，`expectedRevision` 取自已有记录或最近写回执；没有版本时再读取：

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function deleteDevice(
  collectionId: string, id: string, expectedRevision: UnsV2Integer,
  intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.recordDeleteOne({
    collectionId, filter: { _id: id }, expectedRevision,
    dryRun: false, idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.deletedCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt };
}
```

元数据使用 metadataDeleteOne/Many；需要删除前对象时传 returnDocument:before。已知 revision 可直接提交，不要求重新读取或先 dryRun。

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function deleteCollection(
  id: string, expectedRevision: UnsV2Integer,
  intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.metadataDeleteOne({
    kind: 'collection', filter: { _id: id }, expectedRevision,
    dryRun: false, idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.deletedCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'deleted' as const, receipt };
}
```

metadataDeleteMany 使用明确 filter 和 maxDocs。默认原子；超过上限整体拒绝。目录删除的 maxDocs 与 deletedCount 只计显式匹配项，不计隐式级联后代；服务端会去重父子项，无需逐个删除后代。需要预览时可 dryRun。state 默认 active，回收对象通过 state=deleted 查询；all 包含两种状态。

## 回收规则

软删除增加 revision，保留 Record、Sample 与查询索引；历史按既有授权只读，数据写入和后台 TTL 清理停止。外部引用不阻止回收，引用方配置保留；删除 Topic 不删除其引用的 Collection。

| 操作 | 范围与授权 |
| --- | --- |
| 元数据软删除 | 目录在同一事务内回收有效子树；此前独立回收的对象不加入本次批次。既有授权保留。 |
| App 集合 archive | 归档指定自有集合，撤销调用 App 对它的 grant；其他未撤销授权仍可读取历史。 |
| App 移入回收站 | 停用该 App，联动回收其自有集合和明确专属目录；借用集合、共享目录保留，其他活跃授权主体仍可读取历史。 |

恢复范围和授权区别见[恢复](restore.md)。保留的物理索引仍占配额，归档不释放索引空间。

业务记录使用 recordDeleteOne/Many，传 collectionId 和明确 filter，编辑型流程同时传 expectedRevision。不要把元数据软删除解释成逐条删除该集合的 Record。Sample 使用独立的精确清单或显式时间范围删除接口；清理选定样本使用下面的 sampleDeleteExact。

成功回执已确认本次操作，不再固定读回验证。结果未知时保留原意图键，按对象身份核对；需要展示最新状态时再刷新。版本冲突应重新读取并由调用方处理，不自动覆盖。

## 精确删除历史样本

Workspace 管理调用方通过 `client.uns.sampleDeleteExact` 删除当前集合内的明确样本清单，最多 200 条，需要 `uns.delete` 权限；MCP 凭证另需 `uns.write` 授权。运行时 App Key 不支持此操作，也没有对应的 App 数据层方法。

从 `sampleFind` 结果复制 `{recordId,id,time}`，保留原始 Unix 毫秒时间；`id` 不能替代完整身份，`receivedAt` 不能替代 `time`。不接受空清单、重复身份、filter 或时间范围。清理重复样本时，由业务判断哪些样本重复、保留哪条，只把多余项放入清单；接口本身不判断重复，也不改变采集逻辑。

```ts
import { createClient, type Tier0Client, type UnsV2SampleDeleteExactReq } from '@tier0/sdk-v2';

export async function deleteSelectedSamples(
  collectionId: string, samples: UnsV2SampleDeleteExactReq['samples'],
  intentKey: string, dryRun = true, client: Tier0Client = createClient(),
) {
  return client.uns.sampleDeleteExact({ collectionId, samples, dryRun, idempotencyKey: intentKey });
}
```

`dryRun:true` 仅返回当时的匹配数量，不删除或预留样本。执行时使用同一清单和 `dryRun:false`；省略 dryRun 也会执行。返回 `{deletedCount,missingCount,dryRun}`：deletedCount 在预览时是预计删除数，执行时是实际删除数；missingCount 是未匹配到的完整键数。整批精确删除与回执同事务，不修改父 Record 或未列出的样本。

相同执行请求重试复用相同 `idempotencyKey`，修改清单需要新键。SDK 不自动重试；结局未知时按完整键查询核对，遵循错误中的 execution/retry，不改用范围删除或重建集合。`sampleDeleteRange` 仍不向 MCP 开放。

## 永久删除回收站集合

Workspace 管理调用方使用 `metadataPurge`，传 `kind:'collection'` 和 1–200 个明确 `ids`。
只允许回收站集合；清空时先查全分页并固定这次选中的 ID，再按批调用同一个接口。
不另传 `force`、`cascade`、确认 token，也不要求先清空记录或执行 dryRun。
运行时 App 凭证不开放此操作；权限由后端统一校验。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function purgeCollections(
  ids: string[], intentKey: string, client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.metadataPurge({
    kind: 'collection', ids, idempotencyKey: intentKey,
  });
  return { state: 'submitted' as const, receipt };
}
```

`status:accepted` 和 `jobId` 表示已受理，不表示已永久删除。通过 `client.uns.jobs`
查询任务并检查终态和逐项结果；部分失败不能报告整批成功，中断后继续查询原任务或复用原意图键。
永久删除包括全部 Record、Sample、集合元数据、索引以及指向集合的 App 授权；不连带删除 Topic、Source、Stream。
清理开始后不能恢复。索引由后台回收，不能仅凭已受理或数据清理回执声称物理空间已全部释放。
可选 `dryRun:true` 只返回校验结果，不创建清理任务。
