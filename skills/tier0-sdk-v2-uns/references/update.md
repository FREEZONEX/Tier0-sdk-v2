# 修改记录、集合元数据和 Schema

| 方法 | 关键输入 | 语义 |
| --- | --- | --- |
| recordUpdateOne | collectionId、filter、update、expectedRevision | 修改一个精确目标 |
| collectionUpdate | dryRun、items[].id/name/description/parentId/expectedRevision | 修改元数据 |
| collectionSchemaUpdate | dryRun、items[].id/recordSchema/expectedRevision | 替换 recordSchema |

写前读取 revision；冲突后重新比较并决策。省略 expectedRevision 可能覆盖最新状态，示例始终携带。

## 修改一条设备记录

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function renameDevice(
  collectionId: string, id: string, name: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const found = await client.uns.recordFind({ collectionId, filter: { _id: id }, limit: 1 });
  const current = found.data.items[0];
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

data 返回 matchedCount、modifiedCount、status、replayed。modifiedCount=0 可能是值未变化；不能据此断言请求失败。upsert=false 避免不存在时意外创建。批量修改只在明确筛选范围和授权内使用。

## 修改集合名称

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function renameCollection(
  id: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const { data: current } = await client.uns.collectionGet({ id });
  const receipt = await client.uns.collectionUpdate({
    dryRun: false, mode: 'sync', allowPartial: false, idempotencyKey: intentKey,
    items: [{ id, name, expectedRevision: current.revision }],
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt, current: (await client.uns.collectionGet({ id })).data };
}
```

## 扩展 Schema：添加可选位置字段

```ts
import { createClient, type Tier0Client, type Schema } from '@tier0/sdk-v2';

export async function addDeviceLocation(
  id: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const { data: current } = await client.uns.collectionGet({ id });
  if (current.data.recordSchema.type !== 'object') throw new Error('此示例仅支持对象 Schema');
  if (current.data.recordSchema.properties?.location) throw new Error('location 已定义，应先比较原 Schema');
  const recordSchema: Schema = {
    ...current.data.recordSchema,
    properties: { ...current.data.recordSchema.properties, location: { type: 'string' } },
  };
  const item = { id, expectedRevision: current.revision, recordSchema };
  const preview = await client.uns.collectionSchemaUpdate({ dryRun: true, mode: 'sync', items: [item] });
  if (preview.data.status !== 'validated') throw new Error('Schema 预检未通过');
  const receipt = await client.uns.collectionSchemaUpdate({
    dryRun: false, mode: 'sync', allowPartial: false, items: [item], idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt, current: (await client.uns.collectionGet({ id })).data };
}
```

recordSchema 是完整替换，不是 merge patch，也不自动迁移记录。新 Schema 必须接受已有数据并满足相关引用约束。sampleSchema/indexes 省略时保留；不要为了添加一个字段顺手清空它们。收紧类型、增加必填或删除采样 Schema 需额外评估已有数据。
