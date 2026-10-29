# 修改 Stream 草稿

方法：`stream.documents.update`；POST `/openapi/v2/uns/streams/documents/update`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 十进制字符串 |
| document | CloudStreamDocument | 是 | name、model、script、sources、entries 完整文档 |
| expectedRevision | integer | 建议始终提供 | 当前回执或查询的修订，防止覆盖他人修改 |
| dryRun | boolean | 是 | true 预检；false 保存 |
| idempotencyKey | string | 否 | 本次更新独立意图键 |

## 示例：更新描述，保持脚本和绑定

```ts
import { createClient, type Tier0Client, type CloudStreamDocument, type CloudStreamDocumentView } from '@tier0/sdk-v2';

export async function updateStreamDescription(
  current: CloudStreamDocumentView, description: string, intentKey: string, client: Tier0Client = createClient(),
) {
  const document: CloudStreamDocument = { ...current.document, description };
  const saved = await client.stream.documents.update({
    id: current.id, expectedRevision: current.revision, document, dryRun: false, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('未返回已保存文档');
  return { receipt: saved, current: saved.data };
}
```

代码应用可直接用 documents.update({id, expectedRevision, program, dryRun:false, idempotencyKey})，由服务端编译入口和绑定。编辑完整文档时保留 script.code/timeoutMs，并同步 entries/sources；写入本身执行校验，只有需要提前展示问题时才单独 validate。不要对documents.get 的 summary 做展开更新。

响应是完整 CloudStreamDocumentView 或预检结果；把 saved.data 直接传给下一步[发布示例](deploy.md)，无需为了 revision 再读取。示例复用创建/更新回执；只有缺少完整文档时才先 get({id,view:"full"}) 并确认 document 存在。保存草稿不会自动部署，activeDocument 可能仍是旧发布版本。VERSION_CONFLICT 后重新读取、比较并决策；不无条件覆盖。
