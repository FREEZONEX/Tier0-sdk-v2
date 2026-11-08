# 目录、Topic 与元数据事务

## 先确定凭证与查询目的

`client.uns.namespace()` 对应 `POST /openapi/v2/uns/namespace/query`，不是内部接口。SDK 保留该方法供有权限的工作空间调用方使用；SDK 方法目录不是当前凭证的授权清单。

| 凭证 | Namespace / metadata 查询 | 发现并读取集合 |
| --- | --- | --- |
| 未绑定 App 的 Agent / Personal Key | 有当前工作空间权限及 Key scope 时可用；Agent Key 还会复核真实负责人的状态和权限 | 已知集合 ID 时直接调用 `recordFind`；需要发现集合时按工作空间权限查询元数据 |
| App Key | 当前不开放；`appCollectionsList` 也不能调用 | 已知集合 ID 时直接调用 `recordFind`；需要发现集合及结构时使用 `dataAppContext({})` |
| 平台系统 Service Key | 按实际系统凭证授权，不按“Agent 正在调用”推定权限 | 带 Builder 目标时，指定 App 操作可使用目标 App 视角；不代表所有查询都变成 App 视角 |

目录位置不产生数据授权。App 自有集合的正常创建流程提供相应授权，但读取仍受凭证权限、App 状态及数据策略约束；不能仅凭 `ownerAppId` 推定任何接口都可调用。SDK 和 MCP 使用相同凭证时仍受服务端授权约束。

收到 `403 FORBIDDEN` 且原因为 `operation is not available to App credentials` 时，先核对调用接口与服务端确认的凭证身份。这是操作准入拒绝，不能据此认定 Collection 不可读或没有数据。App 的正确流程见[读取示例](read.md)；不要重试同一不允许的操作、改走内部接口或自动换成权限更大的 Key。记录 `requestId`；错误文案仅供诊断，不在程序中匹配文案作权限判断。

## 工作空间目录管理

目录、Topic、Collection 使用同一套 metadata* 方法，通过 kind 指定类型。Source/Stream 的启停、连接和发布仍使用各自专用生命周期接口；不允许把系统任务、凭据或发布历史当作普通元数据修改。

目录、Collection 和 Topic 直接以 name 展示业务名称，不提供 displayName。系统引用用 ID，App 程序标识用独立 alias；名称改动不影响它们。不要用随机串、时间戳或 ID 拼接名称，也不自动用无意义后缀解决重名。

工业目录优先按实际 ISA-95 设备层级组织：企业 → 工厂/站点 → 区域/车间 → 工作中心（产线等）→ 工作单元。创建前用 `metadataFind` 查询相关已有目录和集合，结合名称与 `parentId` 确认位置，有分页时继续读取。优先复用，只创建业务需要且缺失的层级，通过 `data.parentId` 挂接；不为凑齐层级编造工厂设备，也不按每个 App 重建一套目录。跨区域共享数据放到适合其业务范围的共同祖先；非工业业务按真实业务结构组织，不用 Level 0–4 控制功能层级替代设备层级。整理时不擅自移动已有数据或更改权限。

例如已有“上海工厂 / 装配车间”，新增一条产线的数据只补缺少的产线节点；车间共享集合可直接放在车间下。App 的 `defineCollection` / ensure 使用 `directoryPath` 声明从 Workspace 根开始的真实业务目录名称数组，逐级复用或创建目录；不接收 `parentId`，也不默认放在缺少业务范围的根级 App 目录。允许在已知业务范围下使用 App 或模块目录，例如“工厂 / 产线 / MES / 工单”中的 MES；App 目录不能替代已知的工厂、产线范围。其他元数据创建入口仍使用 `data.parentId`。已有集合可按 ID 引用，目录位置不决定归属或权限；声明路径变化不会自动移动已有集合。

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

下面示例只用于确认已有父目录下缺少一个业务节点的情况；若节点已存在，直接复用其 ID 创建 Topic。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createDirectoryAndTopic(
  parentId: string, directoryId: string, directoryName: string,
  topicId: string, collectionId: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  return client.uns.metadataTransact({
    idempotencyKey: intentKey,
    operations: [
      { opId: 'directory', action: 'insertOne', kind: 'directory', id: directoryId,
        data: { name: directoryName, parentId } },
      { opId: 'topic', action: 'insertOne', kind: 'topic', id: topicId, dependsOn: ['directory'],
        data: { name: '设备视图', parentId: { ref: 'directory' }, viewMode: 'records', collectionId } },
    ],
  });
}
```

transact 始终原子，结果通过 opId 对应输入；dryRun=true 校验，不预留 ID 或名称。正式执行仍重新检查。创建结果引用仅用于契约支持的关系字段，不能把任意字符串或脚本当引用。

名称、父目录、Schema、引用与权限由服务端校验。移动不改变对象 ID；删除目录原子回收有效子树，删除 Topic 不删除所引用的 Collection。外部引用不阻止回收；范围、授权和恢复规则见[删除](delete.md#回收规则)与[恢复](restore.md)。引用查询仍使用 references 专用方法。
