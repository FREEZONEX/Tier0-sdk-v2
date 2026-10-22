# 修改记录、元数据和 Schema

元数据单条使用 metadataUpdateOne 或 metadataFindOneAndUpdate；后者原子返回 value，returnDocument 可选 before/after。批量相同更新使用 metadataUpdateMany；不同更新使用 metadataBulkWrite。完整替换使用 metadataReplaceOne/metadataFindOneAndReplace，replacement 是完整可写配置。

update 首版支持 $set/$unset/$setOnInsert。字段使用裸配置路径；_id/_meta 为只读。写前读取 revision，编辑页面携带 expectedRevision，冲突后重新比较。单条 upsert 需明确 _id 等值条件，新增内容满足完整创建约束；同 ID 的软删除对象必须显式恢复。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function renameCollection(
  id: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const current = (await client.uns.metadataFindOne({ kind: 'collection', filter: { _id: id } })).data.value;
  if (!current) throw new Error('集合不存在或不可见');
  return client.uns.metadataFindOneAndUpdate({
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
  const current = (await client.uns.metadataFindOne({ kind: 'collection', filter: { _id: id } })).data.value;
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
