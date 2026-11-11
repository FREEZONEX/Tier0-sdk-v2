# 新建集合与记录

集合定义与记录内容使用不同接口。App 自有集合通常由 [数据层声明](../../tier0-sdk-v2-data/references/modeling.md) ensure；已有集合直接用真实 ID，不再创建同名集合。

## 工作区集合

metadataInsertOne 接收 kind:'collection'、data:{name,parentId?,recordSchema,sampleSchema?,indexes?}，可选 id/idempotencyKey/dryRun。父目录使用实际 ID，业务目录见 [命名空间](namespace.md)。名称与程序 alias 独立，不用名称当 ID。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createCollection(parentId: string | null, intentKey: string, client: Tier0Client = createClient()) {
  return client.uns.metadataInsertOne({
    kind: 'collection',
    data: {
      name: '生产工单', parentId,
      recordSchema: {
        type: 'object', additionalProperties: false, required: ['code'],
        properties: { code: { type: 'string' }, quantity: { type: 'integer', format: 'int32' } },
      },
      indexes: [{ path: 'code', unique: true }],
    },
    idempotencyKey: intentKey,
  });
}
```

保存 insertedId；需要服务器补全的结构/revision 时再读取。Schema 数值使用 integer/int32、number/float|double，嵌套同样处理；format 不转换或舍入。索引创建异步，ready 后才依赖唯一约束。

## 新增记录与创建快照

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function insertOrder(collectionId: string, id: string, code: string, intentKey: string, client: Tier0Client = createClient()) {
  const receipt = await client.uns.recordInsertOne({
    collectionId, id, data: { code }, returnDocument: 'after',
    dryRun: false, idempotencyKey: intentKey,
  });
  return receipt.data;
}
```

检查 status:'committed'；after 的 value 是 `{id,data,revision,...}` 原始快照，业务字段在 data 中。默认 none 只返回 ID/计数，after 额外需要当前读取权限，projection 仅与 after 同用；新增不支持 before。dryRun 只预览。

同键重放返回原创建快照，不代表当前最新版本；不能用原键把 none 改为 after。新增同 ID 不会自动更新或恢复。批量 insertedIds 按原始零基序号对应输入。未知结局按 ID 核对内容并遵守 execution/retry，见 [数据工作流](data-workflows.md)。
