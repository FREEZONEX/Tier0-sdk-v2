---
name: tier0-sdk-v2-uns
description: 使用 @tier0/sdk-v2 的 client.uns 完成新架构集合、Schema、目录、Topic、Record 增删改查、归档恢复、采样历史与事务，区分 App 和 Workspace 数据权限。
---

# UNS 数据操作

UNS 管数据命名空间、集合、Record 和 Sample；外部连接与脚本分别用 [Source](../tier0-sdk-v2-source/SKILL.md)、[Stream](../tier0-sdk-v2-stream/SKILL.md)。服务端 `createClient()` 读取 TIER0_API_HOST / TIER0_API_KEY，或显式传 apiHost/apiKey。数据权限不自动授予管理权限：管理操作中 App 凭证只能调用本 App 集合的 appCollectionsEnsure / SchemaReplace / Archive / Restore；appDataPolicyGet/Update 的调用方必须是持有 uns.write 的登录会话、持有 uns.write 且 full_access、不绑定 App 的 personal / agent Key，或治理会话；运行时 App 凭证不能管理数据授权。

## 按任务加载参考

| 用户任务 | 参考 | 方法 |
| --- | --- | --- |
| 创建集合、定义 Schema、新增记录 | [创建](references/create.md) | metadataInsertOne、metadataBulkWrite、recordInsertOne |
| 查询集合、筛选/排序记录 | [查询](references/read.md) | metadataFind、collectionDescribe、recordFind |
| 改记录、集合名称、扩展 Schema | [修改](references/update.md) | recordUpdateOne、metadataUpdateOne/Many |
| 删记录、软删除集合 | [删除](references/delete.md) | recordDeleteOne、metadataDeleteOne/Many |
| 恢复集合或记录 | [恢复](references/restore.md) | metadataRestore、recordRestore |
| 分页、历史采样、事务、变更订阅 | [数据工作流](references/data-workflows.md) | sampleFind、recordTransactionExecute；订阅使用独立 SSE GET |
| 目录、Topic 元数据及组合事务 | [命名空间](references/namespace.md) | metadata*、metadataBulkWrite、metadataTransact |

## 找到正确数据上下文

托管 App 使用 dataAppContext，按业务 alias 精确选择授权集合；Workspace 集成用 dataDiscover/metadataFind，不强制 App 上下文。App 凭证的 metadataFind/FindOne 只读授权内 active Collection，查询和投影限 _id/_meta/name/parentId；通用元数据管理写入不向 App 凭证开放。

```ts
import { createClient } from '@tier0/sdk-v2';

export async function findAppCollection(alias: string) {
  const client = createClient();
  const context = await client.uns.dataAppContext({});
  const collection = context.data.collections.find(item => item.alias === alias);
  if (!collection) throw new Error('当前 App 未获得目标集合授权');
  return client.uns.collectionDescribe({ collectionId: collection.collectionId });
}
```

不要把 alias/名称当 collectionId，不猜第一个集合是业务目标。

平台签发的 App Key 声明本 App 自有集合使用 appCollectionsEnsure，修改结构、停用及恢复分别使用 appCollectionsSchemaReplace/Archive/Restore；这些保留专用 App 归属和授权语义，不能改成 metadataInsertOne 或普通元数据写入。会话或个人 Key 查询自有集合使用 appCollectionsList。Builder 创建普通授权集合可在 metadataInsertOne 中提供 appId/alias，具体凭证与权限由服务端复验。

## 核心约束

1. 记录行是 id/data/revision；filter 与 update 的业务路径用 name、customer.name，不加 data.；系统路径用 _id、_meta.revision。
2. 改/删前读取 expectedRevision；不同操作使用独立意图键，长度上限以当前操作契约为准。
3. metadataUpdateOne 的 $set.recordSchema 替换完整 Schema，不迁移已有记录；未更新的 sampleSchema/indexes 保留。先预检兼容性。
4. 集合无硬删除入口，用 metadataDeleteOne/Many 软删除；Record 删除会物理删除关联 Sample，恢复 Record 不会恢复这些 Sample。
5. recordFind 使用 pageInfo.hasMore/nextCursor，limit 1–200；sort 为 [['field',1]]。单页不是全量，跨页不是稳定快照。
6. Sample 的时间是 Unix 毫秒，查询范围 [from,to)。Record 代表业务实体，不用覆盖它来保存历史。

## 结果与异常

响应为 code/msg/requestId/data。元数据 find 返回 items/pageInfo；单条查询用 limit:1 后取 items[0]，不存在时为 null。updateOne/replaceOne 默认返回计数，显式 returnDocument:'before'|'after' 时额外返回 value；deleteOne 只接受 none/before。projection 必须与显式 before/after 同传。metadataTransact 的 results 按 opId 对应。检查 committed、每项错误和实际计数；dryRun 只校验。metadataBulkWrite 默认原子，显式非原子时必须逐项检查 results/errors；跨 kind 的依赖写入使用 metadataTransact。recordBulkWrite 不保证跨集合事务。

旧 findOneAnd*、insertMany、distinct 与 metadataFindOne 保留原路由和回执身份。新意图可用 bindUnsV2NewRequests 的便利包装，批量写入返回 canonical bulk 回执；不得拿旧操作已发送的幂等键改投新路由。推荐目录由 listUnsV2Operations('recommended'|'starter'|'all') 生成，分组不改变权限。

大整数与 JSON 精确数字可能为 bigint/UnsV2RawNumber；保留读取到的 revision 类型，不用 Number 或普通 JSON.stringify 做无损往返。UnsV2OutcomeUnknownError 先读回核对内容或查询 jobs；取消请求不撤销写入，SDK 不自动重试。
