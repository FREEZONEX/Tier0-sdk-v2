# Source 影响分析

方法：`source.impact`；POST `/openapi/v2/uns/sources/impact`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id / expectedRevision | string / integer | 是 | 当前 ID 和读取到的修订 |
| action | update/enable/disable/delete | 是 | 精确变更类型 |
| document / patch | CloudSourceDocument / CloudSourceDocumentPatch | 更新时 | 二选一，必须与后续提交的意图完全一致；启停/删除不传 |
| offset / size | integer | 否 | 首次 0；size 1–200 |
| impactRevision | string | 翻页时 | 沿用首次返回的确认值 |

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function collectSourceImpact(
  intent: UnsV2Request<'sourceImpact'>,
  client: Tier0Client = createClient(),
) {
  const first = await client.source.impact({ ...intent, offset: 0, size: 200 });
  const references = [...first.data.references];
  let offset = first.data.nextOffset;
  const seen = new Set<string>();
  while (String(offset) !== '0') {
    if (seen.has(String(offset))) throw new Error('影响分页未前进');
    seen.add(String(offset));
    const next = await client.source.impact({
      ...intent, offset, size: 200, impactRevision: first.data.impactRevision,
    });
    if (next.data.impactRevision !== first.data.impactRevision) throw new Error('影响确认值发生变化');
    references.push(...next.data.references);
    offset = next.data.nextOffset;
  }
  return { ...first.data, references, nextOffset: offset };
}
```

data：impactRevision、sourceID/sourceRevision、action、counts（draft/activeRelease/historicalRelease）、restrictedCount、references、nextOffset、expiresAt。nextOffset=0 结束；complete=1 表示计算完成，不表示首页有全部引用。

确认值绑定身份、修订、精确意图，不能合成或自动刷新。评估 counts 和 restrictedCount；有受限引用时不能说“无影响”。Source 更新不会自动替换 Stream 冻结修订。已有明确操作授权时不重复索要确认；影响分析本身不授予额外操作权限。
