# 修改 Stream 草稿

方法：`stream.documents.update`；POST `/openapi/v2/uns/streams/documents/update`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 十进制字符串 |
| document / program | 生成类型 | 二选一 | 完整原生文档，或 RuntimeStreamDefinition 程序输入 |
| expectedRevision | integer | 建议始终提供 | get 返回修订，防止覆盖他人修改 |
| dryRun | boolean | 是 | true 预检；false 保存 |
| idempotencyKey | string | 否 | 本次更新独立意图键 |

## 示例：更新描述，保持脚本和绑定

```ts
import { createClient, type Tier0Client, type CloudStreamDocument } from '@tier0/sdk-v2';

export async function updateStreamDescription(
  id: string, description: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const { data: current } = await client.stream.documents.get({ id });
  const document: CloudStreamDocument = { ...current.document, description };
  const checked = await client.stream.documents.validate({ document });
  if (!checked.data.valid) throw new Error('Stream 文档校验失败，请检查 issues');
  const saved = await client.stream.documents.update({
    id, expectedRevision: current.revision, document, dryRun: false, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存文档');
  return { receipt: saved, current: (await client.stream.documents.get({ id })).data };
}
```

需要改脚本时构造 `{ ...current.document, script: { ...current.document.script, code: newCode } }`，保留 sdkVersion/timeoutMs；变更入口或绑定时同步修改 entries/sources 并重新 validate。不要对脱敏 programs.get.document 做展开更新。

响应是完整 CloudStreamDocumentView 或预检结果；保存草稿不会自动部署，activeDocument 可能仍是旧发布版本。VERSION_CONFLICT 后重新读取、比较并决策；不无条件覆盖。下一步发布见[部署](deploy.md)。
