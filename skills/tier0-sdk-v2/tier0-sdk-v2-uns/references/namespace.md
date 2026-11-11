# 业务目录、Topic 与元数据事务

metadata 系列按 kind 管理 directory/topic/collection。Source/Stream 生命周期与 App 数据授权使用专用入口。App 运行时不开放 namespace、metadata、appCollectionsList，发现可用集合用 dataAppContext；已知 ID 直接读写。

## 目录组织

工业数据优先复用实际 ISA-95 设备层级：企业 → 工厂/站点 → 区域/车间 → 工作中心 → 工作单元。只创建业务已知且缺少的节点，不强凑五层；MES 等业务模块可位于已知工厂/产线范围下，共享数据放共同祖先。非工业业务按自身结构组织。

管理身份用 metadataFind 核对名称与 parentId，有分页时继续读取；创建通过 data.parentId 挂接实际 ID。App 声明使用 directoryPath 名称数组，由 ensure 创建/复用目录，无需让运行时 Key 调管理查询。目录不决定所属 App 或访问权限，改声明路径不移动已有集合。

## 选择写入方式

| 需求 | 方法 |
| --- | --- |
| 新建一个资源 | metadataInsertOne |
| 单条/同样批量更新 | metadataUpdateOne/Many |
| 完整替换 | metadataReplaceOne |
| 同 kind 不同操作 | metadataBulkWrite |
| 跨 kind 依赖操作、全部成功或回滚 | metadataTransact |
| 软删除/恢复 | metadataDeleteOne/Many、metadataRestore |

```ts
import { createClient } from '@tier0/sdk-v2';

export async function createDirectoryAndTopic(parentId: string, collectionId: string, intentKey: string) {
  return createClient().uns.metadataTransact({
    idempotencyKey: intentKey,
    operations: [
      { opId: 'directory', action: 'insertOne', kind: 'directory', data: { name: '产线看板', parentId } },
      { opId: 'topic', action: 'insertOne', kind: 'topic', dependsOn: ['directory'],
        data: { name: '设备视图', parentId: { ref: 'directory' }, viewMode: 'records', collectionId } },
    ],
  });
}
```

例子仅用于确需新目录的位置；已有节点直接复用 ID。引用只用于契约支持的关系字段，transact results 按 opId 对应。dryRun 不预留 ID/名称，正式执行重新校验。

批次最多 200 项。updateMany/deleteMany/restore 原子；bulkWrite 默认原子，atomic:false 时按 ordered 决定遇错停止或继续，检查 results/errors/nextIndex，unknownUntil 范围先核对，不整体重做。每对象不同 revision 放在逐项操作，不能给所有对象套一个相同版本。

目录删除原子回收有效子树；Topic 删除不删除其集合；外部引用不阻止集合回收。具体保留、恢复和永久删除见 [删除](delete.md#回收规则) 与 [恢复](restore.md)。
