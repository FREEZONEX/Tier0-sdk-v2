# 创建集合与记录

元数据使用 metadataInsertOne（POST /openapi/v2/uns/metadata）或 metadataInsertMany；kind 指定 directory/topic/collection。单条提供 data、可选 id；批量提供同一 kind 的 documents[{id?,data}]。idempotencyKey 标识一个写入意图；dryRun=true 仅校验。schemaVersion 由服务端赋默认值。

集合 data 必须包含 name、recordSchema，可选 description、parentId、sampleSchema、indexes、semantics。parentId=null 表示根目录。索引创建后仍需确认状态为 ready。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function createDeviceCollection(
  collectionId: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const request: UnsV2Request<'metadataInsertOne'> = {
    kind: 'collection', id: collectionId,
    data: {
      name, parentId: null,
      recordSchema: {
        type: 'object', additionalProperties: false, required: ['name', 'enabled'],
        properties: { name: { type: 'string' }, enabled: { type: 'boolean' } },
      },
      sampleSchema: {
        type: 'object', additionalProperties: false, required: ['temperature'],
        properties: { temperature: { type: 'number', unit: '°C' } },
      },
    },
  };
  const preview = await client.uns.metadataInsertOne({ ...request, dryRun: true });
  if (preview.data.status !== 'validated') throw new Error('集合预检未通过');
  const receipt = await client.uns.metadataInsertOne({ ...request, dryRun: false, idempotencyKey: intentKey });
  if (receipt.data.status !== 'committed') return { state: 'unconfirmed' as const, receipt };
  const current = await client.uns.metadataFindOne({ kind: 'collection', filter: { _id: collectionId } });
  if (!current.data.value) throw new Error('集合创建有回执，读回未确认');
  return { state: 'committed' as const, receipt, current: current.data.value };
}
```

单条新增默认返回 insertedId/status/replayed。需要创建后的数据、revision 和时间戳时，传 returnDocument:'after'，同一次写入返回 value，无需再查询；可配合 projection，调用者必须同时具有读取权限。幂等重放返回原始创建快照，后续读取最新状态仍用 recordGet/recordFind。dryRun 的 value 是未提交预览。

returnDocument 只允许 none（默认）或 after，不支持 before；projection 只能和 after 一起传。新增仍是 insert，已存在的 ID 不会变成更新。after 的 value 包括服务端补入的字段，但只返回当前授权可见的数据：普通数据权限需 uns.write 和 uns.read，App 还要满足集合的 record:write / record:read 及当前员工、行和字段策略。服务端在提交前校验读取权限，重放时也重新校验；旧回执不能绕过已撤销的授权。

省略 returnDocument 与显式 none 保持相同幂等语义。不能用同一个意图键把原来的 none 改成 after 补取快照，否则返回 IDEMPOTENCY_CONFLICT；已创建的记录应改用读取接口。after 重放可对原始快照应用 projection，但不会变成最新记录。创建快照中的 revision 可用于下一次修改；若已有并发修改，版本冲突仍需显式处理。

批量新增返回 insertedCount/insertedIds 及适用的逐项错误。insertedIds 的键是原始输入从 0 开始的索引。省略自定义 ID 时从成功回执取得实际 ID，不能把名称当成 ID。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function insertDevice(
  collectionId: string, id: string, name: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.recordInsertOne({
    collectionId, id, data: { name, enabled: true }, dryRun: false, idempotencyKey: intentKey, returnDocument: 'after',
  });
  if (receipt.data.status !== 'committed') return { state: 'unconfirmed' as const, receipt };
  if (!receipt.data.value) throw new Error('创建回执缺少请求的快照');
  return { state: 'committed' as const, receipt, created: receipt.data.value };
}
```

记录创建与集合创建使用不同意图键。未知结果先按 ID 核对内容，不仅检查存在；SDK 不自动重试。
