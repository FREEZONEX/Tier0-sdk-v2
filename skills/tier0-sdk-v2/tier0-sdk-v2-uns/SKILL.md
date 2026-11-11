---
name: tier0-sdk-v2-uns
description: 使用 @tier0/sdk-v2 的 client.uns 管理 Collection、目录、Topic 和 App 集合授权，直接读写 Record/Sample，处理分页、版本冲突、回收与未知写入结果。
---

# UNS 原始接口

`client.uns` 提供类型化的公开 API，返回 `{code,msg,requestId,data}`。Collection 是持久化记录及结构，Source/Stream 管理使用各自指南。App 的常规业务代码优先用 [数据层](../tier0-sdk-v2-data/SKILL.md)，已有集合可直接按 ID 引用。

## 先选身份与目标

- 已知 collectionId：直接调用 recordFind 等记录接口，无需先查询元数据或 ensure。
- App 运行时发现可用集合：dataAppContext，返回集合、有效权限、Schema、revision、indexStatus、ttl 和 limits。App 不能调用通用 metadata/namespace、异步写入或 jobs，也不能自行管理集合授权。
- Builder 和工作区管理身份：按当前有效权限使用 metadata、目录及授权接口。Builder 以系统身份为同一工作区的目标 App 配置已有集合授权，不依赖对话用户角色；当前绑定 App 是构建上下文。
- App 自有集合声明：appCollectionsEnsure；显式生命周期使用 appCollectionsSchemaReplace/Archive/Restore。通用元数据创建不能替代这些 App 专用语义。

名称与 alias 不是 collectionId。原始 Record 是 `{id,data,revision,...}`，查询/更新的业务路径是 name、customer.name，系统路径是 _id、_meta.revision。SDK 数据层才返回扁平 `_id` 文档。

| 任务 | 参考 |
| --- | --- |
| 新建集合/记录、返回创建快照 | [创建](references/create.md) |
| 查集合/记录、回收历史 | [读取](references/read.md) |
| 更新记录/Schema、给 App 授权已有集合 | [修改](references/update.md) |
| 删除记录、回收集合、清理样本和永久删除 | [删除](references/delete.md) |
| 恢复集合或记录 | [恢复](references/restore.md) |
| 完整分页、采样、事务和写入恢复 | [数据工作流](references/data-workflows.md) |
| 业务目录、Topic、元数据事务 | [命名空间](references/namespace.md) |

## 写入结果

单条编辑用最近读取或回执的 revision 作为 expectedRevision。成功检查 committed 与操作计数；批量检查逐项结果，accepted/jobId 只表示受理，dryRun 只校验。需要写后快照用 returnDocument，不固定另发读取。

`client.uns` 不自动重试。`UnsV2Error` 的 code/reason/path、requestId、execution/retry 定位错误；`UnsV2OutcomeUnknownError` 表示可能已执行，先核对原意图，retry.safe 时才用原请求和原幂等键重试。取消请求不撤销写入。

大整数可能为 bigint/UnsV2RawNumber；保留读取到的 revision 类型，不能用 Number 或普通 JSON.stringify 做无损往返。Schema 不兼容不会因为 JSONB 存储而自动转换；回收和删除记录的保留范围也不同，按相应参考处理。
