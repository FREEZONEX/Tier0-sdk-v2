# 创建集合与记录

| 方法 | POST 路径 | 用途 |
| --- | --- | --- |
| uns.collectionCreate | /openapi/v2/uns/collections/create | 创建集合及 Schema |
| uns.recordInsertOne | /openapi/v2/uns/collections/{collectionId}/records | 新增业务记录 |

## 集合参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 是 | true 预检；false 提交 |
| items[].id | string | 否 | 可指定稳定业务 ID，不能与已有集合冲突 |
| items[].name | string | 是 | 1–63 字符 |
| items[].recordSchema | Schema | 是 | 至少 type；对象可含 properties/required |
| items[].sampleSchema | Schema | 否 | 需要采样时配置 |
| items[].parentId | string/null | 否 | 目录 ID；null 或创建时省略表示根 |
| items[].indexes | IndexSpec[] | 否 | 索引定义，不能把索引创建当成已 ready |
| mode / allowPartial | string / boolean | 否 | 示例 sync / false |
| idempotencyKey | string | 否 | 集合管理最多 128 字符 |

## 完整示例：设备集合

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function createDeviceCollection(
  collectionId: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const item: UnsV2Request<'collectionCreate'>['items'][number] = {
    id: collectionId, name, parentId: null,
    recordSchema: {
      type: 'object', additionalProperties: false, required: ['name', 'enabled'],
      properties: { name: { type: 'string' }, enabled: { type: 'boolean' } },
    },
    sampleSchema: {
      type: 'object', additionalProperties: false, required: ['temperature'],
      properties: { temperature: { type: 'number', unit: '°C' } },
    },
  };
  const preview = await client.uns.collectionCreate({ dryRun: true, mode: 'sync', items: [item] });
  if (preview.data.status !== 'validated') throw new Error('集合预检未通过');
  const receipt = await client.uns.collectionCreate({
    dryRun: false, mode: 'sync', allowPartial: false, items: [item], idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed' || receipt.data.results?.some(item => item.error)) {
    return { state: 'unconfirmed' as const, receipt };
  }
  return { state: 'committed' as const, receipt,
    current: (await client.uns.collectionGet({ id: collectionId })).data };
}
```

返回 Outcome：status、results、replayed，可含 jobId/summary。accepted 需要作业对账；validated 不表示已创建。省略自定义 ID 时从成功 results[].id 取得实际 ID，不能用集合名称代替。

## 新增设备记录

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| collectionId | string | 是 | 已存在且有权限的集合 |
| id | string | 否 | 可指定稳定记录 ID |
| data | object | 是 | 符合 recordSchema 的业务字段 |
| dryRun | boolean | 否 | 默认 false，示例显式给出 |
| idempotencyKey | string | 否 | 记录写入最多 96 字符 |

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function insertDevice(
  collectionId: string, id: string, name: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  const receipt = await client.uns.recordInsertOne({
    collectionId, id, data: { name, enabled: true }, dryRun: false, idempotencyKey: intentKey,
  });
  if (receipt.data.status !== 'committed') return { state: 'unconfirmed' as const, receipt };
  const found = await client.uns.recordFind({
    collectionId, filter: { _id: receipt.data.insertedId }, limit: 1,
  });
  if (!found.data.items[0]) throw new Error('新增有回执，但读回未找到记录');
  return { state: 'committed' as const, receipt, current: found.data.items[0] };
}
```

成功 data：insertedId、status、replayed；不能把 replayed 误解为本次重复插入。记录创建与集合创建用不同意图键。未知结果先按 ID 核对业务内容，不仅检查“存在”。
