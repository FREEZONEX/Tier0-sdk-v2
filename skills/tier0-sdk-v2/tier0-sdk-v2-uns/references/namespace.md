# 目录、Topic 与元数据事务

目录、Topic、Collection 使用同一套 metadata* 方法，通过 kind 指定类型。Source/Stream 的启停、连接和发布仍使用各自专用生命周期接口；不允许把系统任务、凭据或发布历史当作普通元数据修改。

目录、Collection 和 Topic 直接以 name 展示业务名称，不提供 displayName。系统引用用 ID，App 程序标识用独立 alias；名称改动不影响它们。不要用随机串、时间戳或 ID 拼接名称，也不自动用无意义后缀解决重名。

工业目录优先按实际 ISA-95 设备层级组织：企业 → 工厂/站点 → 区域/车间 → 工作中心（产线等）→ 工作单元。先查询并复用已有目录，只建立业务已知且有意义的层级；通过 parentId 挂接，跨区域共享数据放到共同祖先。不要编造工厂设备，也不用 Level 0–4 控制功能层级替代设备层级；非工业业务按真实业务结构组织。整理时不擅自移动已有数据或更改权限。

| 场景 | 方法 |
| --- | --- |
| 单条/批量新增 | metadataInsertOne / metadataBulkWrite 的 insertOne 项 |
| 单条/批量条件更新 | metadataUpdateOne / metadataUpdateMany |
| 更新并读取原子结果 | metadataUpdateOne / metadataReplaceOne + returnDocument:before/after |
| 同 kind 混合写入 | metadataBulkWrite |
| 跨 kind、有依赖的组合操作 | metadataTransact |
| 软删除并返回原对象 | metadataDeleteOne + returnDocument:before |
| 按明确 ID 批量恢复 | metadataRestore |

普通写操作只指定一个 kind。updateMany/deleteMany/restore 固定原子执行；bulkWrite 默认 atomic=true，原子批次不接受 ordered=false。bulkWrite 显式 atomic=false 时 ordered=true 遇错停止，false 继续，并检查 results/errors。非原子执行有任一项已提交后失败时，`execution` 为 committed、`retry.safe` 为 false，错误的 data 是累计结果：序号小于 `nextIndex` 且不在 errors 里的操作已提交；有 `unknownUntil` 时 `[nextIndex, unknownUntil)` 结局未知，用同一个幂等键重试（不带键时只有按 id 的操作能先读回再续做，所以非原子批次始终带幂等键）；没有 `unknownUntil` 时从 `nextIndex` 续做。第一块就结局未知时 `execution` 为 unknown。批次最多 200 项。不要给所有对象套一个相同 expectedRevision：需要逐项版本检查时在 bulkWrite 中分别提供。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createDirectoryAndTopic(
  directoryId: string, topicId: string, collectionId: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  return client.uns.metadataTransact({
    idempotencyKey: intentKey,
    operations: [
      { opId: 'directory', action: 'insertOne', kind: 'directory', id: directoryId,
        data: { name: '设备目录', parentId: null } },
      { opId: 'topic', action: 'insertOne', kind: 'topic', id: topicId, dependsOn: ['directory'],
        data: { name: '设备视图', parentId: { ref: 'directory' }, viewMode: 'records', collectionId } },
    ],
  });
}
```

transact 始终原子，结果通过 opId 对应输入；dryRun=true 校验，不预留 ID 或名称。正式执行仍重新检查。创建结果引用仅用于契约支持的关系字段，不能把任意字符串或脚本当引用。

名称、父目录、Schema、引用与权限由服务端校验。移动不改变对象 ID；删除目录不隐式清空后代；删除 Topic 不删除所引用的 Collection。引用查询仍使用 references 专用方法。
