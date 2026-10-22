# Source 变更影响与提交

此流程用于修改已存在的 Source。读取或创建源不需要执行这个更新流程。

## 准备精确意图

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type ImpactInput = Parameters<Tier0Client['source']['impact']>[0];
export async function inspectChange(input: ImpactInput) {
  // update 意图必须带拟提交的完整 document；其余 action 以契约要求为准。
  return createClient().source.impact(input);
}
```

input 包含真实 id、读取到的 expectedRevision、action（update/enable/disable/delete）。update 的 document 应保留未修改的连接与认证引用。返回 data.impactRevision 与本次身份、Source 修订和精确意图绑定，不能被新文档复用。

counts 包含 draft、activeRelease、historicalRelease；restrictedCount 表明有不可展开的受限引用，不能将“没显示引用”解释成“没有影响”。complete=1 是影响计算完整标记，不表示 references 全部出现在本页。按服务端 nextOffset 获取后续页，并带同一 impactRevision；不要把分页读取变成重新签发意图。

## 将已确认的变更预览/提交

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type UpdateInput = Parameters<Tier0Client['source']['documents']['update']>[0];
export async function previewConfirmedUpdate(input: Omit<UpdateInput, 'dryRun'>) {
  return createClient().source.documents.update({ ...input, dryRun: true });
}
export async function submitConfirmedUpdate(input: Omit<UpdateInput, 'dryRun'>) {
  return createClient().source.documents.update({ ...input, dryRun: false });
}
```

这两个函数不是连续自动执行的脚本：调用方根据任务意图选择预览或提交。input 必须包含相同 id/expectedRevision/document，以及影响回执给出的 confirmedImpactRevision；提交时保持稳定 idempotencyKey。

revision 冲突、意图变化或确认过期时，先重读并重新评估影响，不能静默修补 token 后重放。受影响的 Stream 可能冻结旧 configRevision，不能假设 Source 更新自动改写所有已发布绑定。

## 验证效果

提交后查询 source.documents.get、history 和 observations.get，区分配置修订、生效状态与连接健康。超时/连接中断时不自动重新提交；若回执带 jobId，按已返回 ID 查询 jobs，结合历史判断是否执行。没有确切结果时报告“结果未知”，不能报告已回滚。
