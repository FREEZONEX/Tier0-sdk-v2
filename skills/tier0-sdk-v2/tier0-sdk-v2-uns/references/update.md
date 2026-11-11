# 更新记录、Schema 与 App 授权

Record 的业务内容用 recordUpdateOne/Many，Collection 的名称、结构用 metadataUpdateOne/Many。不要混淆业务 data 与元数据 data。

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function renameRecord(collectionId: string, id: string, revision: UnsV2Integer, name: string, intentKey: string, client: Tier0Client = createClient()) {
  return client.uns.recordUpdateOne({
    collectionId, filter: { _id: id }, expectedRevision: revision,
    update: { $set: { name } }, returnDocument: 'after', idempotencyKey: intentKey,
  });
}
```

使用最近读到或写回执的 revision，冲突重读比较；不必固定再读一次。matchedCount 与 modifiedCount 不同，值没变化时 modifiedCount 可为 0。业务路径不加 data.。

## 元数据和 Schema

metadataUpdateOne 的 update 使用 $set/$unset/$setOnInsert，metadataReplaceOne 完整替换可写配置；单条可用 returnDocument:before/after 返回原子快照。元数据 upsert 要求 _id 等值和完整合法配置。

`$set.recordSchema` 替换完整 Schema，不转换记录；未更新的 sampleSchema/indexes 保留。有记录时普通更新仅接受兼容放宽，不兼容返回 SCHEMA_INCOMPATIBLE。App 专用 schema:replace 会扫描现存记录，满足目标结构才允许收窄；可选 dryRun 查看影响，见 [Schema 演进](../../tier0-sdk-v2-data/references/schema-evolution.md)。

## 已有集合授权给 App

Builder 用平台注入的系统身份主动完成同一工作区内的目标 App 授权，当前绑定 App 是构建上下文；不从对话用户角色取得权限。外部个人/Agent Key 按自身当前管理权限调用同一入口。App 运行 Key 不能管理授权。

1. 确定真实 appId/collectionId 及业务所需 record:read/write/delete、sample:read/write。
2. appDataPolicyGet 读取当前 status/revision。
3. appDataPolicyUpdate 提交 changes 增量；upsert 指定该集合完整目标权限，alias 可选，其他授权保留。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function grantRead(appId: string, collectionId: string, intentKey: string, client: Tier0Client = createClient()) {
  const current = await client.uns.appDataPolicyGet({ appId });
  const revision = current.data.revision;
  const isNewPolicy = String(revision) === '0';
  if (!isNewPolicy && current.data.status === 'disabled') {
    throw new Error('App 数据策略已停用，关联集合不会自动启用策略');
  }
  return client.uns.appDataPolicyUpdate({
    appId, expectedRevision: isNewPolicy ? 0 : revision, status: isNewPolicy ? 'active' : current.data.status,
    changes: [{ action: 'upsert', collectionId, permissions: ['record:read'] }],
    idempotencyKey: intentKey, dryRun: false,
  });
}
```

该示例将目标集合权限设为只读；扩展授权时按目标保留所需已有权限。changes 与全量 collections 二选一，不能把增量当全量覆盖。revision 为 0（包括 bigint 的 0n）表示尚未创建策略，即使 get 返回 disabled，也以 active 初始化；已有 disabled 策略停止关联，不顺便启用。已有 active 策略继续使用当前状态。版本冲突重读重算，unknown 先核对。

检查 committed，再用真实 App context 与运行时请求确认所需数据可用。管理身份能读到不代表 App 能读；授权下个请求生效，不需重新发布。复用原集合，不复制数据或改变 ownerAppId。
