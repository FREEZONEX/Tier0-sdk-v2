# 修改记录、元数据和 Schema

元数据单条使用 metadataUpdateOne；returnDocument 默认 none，需要原子返回 value 时显式传 before/after。批量相同更新使用 metadataUpdateMany；不同更新使用 metadataBulkWrite。完整替换使用 metadataReplaceOne，replacement 是完整可写配置。

update 首版支持 $set/$unset/$setOnInsert。字段使用裸配置路径；_id/_meta 为只读。写前读取 revision，编辑页面携带 expectedRevision，冲突后重新比较。单条 upsert 需明确 _id 等值条件，新增内容满足完整创建约束；同 ID 的软删除对象必须显式恢复。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function renameCollection(
  id: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const current = (await client.uns.metadataFind({ kind: 'collection', filter: { _id: id }, limit: 1 })).data.items[0];
  if (!current) throw new Error('集合不存在或不可见');
  return client.uns.metadataUpdateOne({
    kind: 'collection', filter: { _id: id }, expectedRevision: current.revision,
    update: { $set: { name } }, returnDocument: 'after', upsert: false, idempotencyKey: intentKey,
  });
}
```

修改 Schema 时先构造完整 recordSchema，再用 $set 更新该字段。它不迁移已有记录，必须兼容保留数据与引用。没有修改的 sampleSchema/indexes 保持原值。先 dryRun，再用独立正式意图键提交。

```ts
import { createClient, type Tier0Client, type Schema } from '@tier0/sdk-v2';

export async function replaceRecordSchema(
  id: string, recordSchema: Schema, intentKey: string, client: Tier0Client = createClient(),
) {
  const current = (await client.uns.metadataFind({ kind: 'collection', filter: { _id: id }, limit: 1 })).data.items[0];
  if (!current) throw new Error('集合不存在或不可见');
  const request = { kind: 'collection' as const, filter: { _id: id },
    expectedRevision: current.revision, update: { $set: { recordSchema } } };
  const preview = await client.uns.metadataUpdateOne({ ...request, dryRun: true });
  if (preview.data.status !== 'validated') throw new Error('Schema 预检未通过');
  return client.uns.metadataUpdateOne({ ...request, dryRun: false, idempotencyKey: intentKey });
}
```

业务记录仍使用 recordUpdateOne：传 collectionId/filter/update，按需携带 expectedRevision。metadataUpdateOne 不能更新 Record 的业务内容。matchedCount 和 modifiedCount 不等价；值未变化时 modifiedCount 可为 0。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function renameDevice(
  collectionId: string, id: string, name: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const current = (await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 })).data.items[0];
  if (!current) throw new Error('记录不存在或不可见');
  const receipt = await client.uns.recordUpdateOne({
    collectionId, filter: { _id: id }, expectedRevision: current.revision,
    update: { $set: { name } }, upsert: false, dryRun: false, idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || String(receipt.data.matchedCount) !== '1') {
    return { state: 'unconfirmed' as const, receipt };
  }
  const after = await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 });
  if (after.data.items[0]?.data.name !== name) throw new Error('读回名称与目标不一致');
  return { state: 'committed' as const, receipt, current: after.data.items[0] };
}
```

## 已有集合授权给 App

这是 Builder 的管理操作，使用内置 MCP 注入的系统身份；不从 App 运行时取得管理 Key，也不需要对话用户具有 Owner/Admin 角色或再次确认。外部 personal / agent Key 按自身当前权限调用同一接口。Builder 可为同一工作区内的 App 管理授权，当前绑定 App 仅是构建上下文。服务端校验工作区、目标 App 状态和所授资源权限，App 运行时凭证不能管理授权。

- 先发现并确认真实的 `collectionId`、结构和当前目标 `appId`；保留已有集合所属 App、目录和数据，不创建同名空集合代替。
- 调用 `appDataPolicyGet({ appId })` 读取当前策略及 `revision`。使用 `appDataPolicyUpdate` 的 `changes` 增量提交，以 `action: 'upsert'`、实际 `collectionId` 和业务所需 `permissions` 关联集合；`alias` 可省略，不能同时传 `collections`。`upsert` 指定该集合的完整目标权限，其他集合授权保留。
- 传入读到的 `expectedRevision`、现有 `status` 和本次操作的独立 `idempotencyKey`，执行时 `dryRun: false`。策略已 `disabled` 时，关联不应顺便重新启用；恢复策略是另一个明确管理动作。
- 检查写入回执 `data.status === 'committed'`，再读取策略核对集合与权限已生效。随后使用 App 运行时的 `dataAppContext` 确认有效授权，并用真实 App 凭证读取已有记录；需要写入时按实际业务验证写入结果。管理身份能查到数据不代表 App 已获授权。

`expectedRevision` 冲突时重读策略并重新计算改动；403 保留原错误，不换凭证或复制集合绕过。结果为 `unknown` 时先读回核对，未确认结果前不自动重试。对话确认不是后端权限凭据，也不需要新增确认字段。
