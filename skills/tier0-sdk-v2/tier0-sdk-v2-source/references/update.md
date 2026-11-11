# 修改 Source

`client.source.documents.update` 使用 id、expectedRevision、patch 或完整 document；两种更新形式二选一。已有修订可直接提交 patch，完整替换需要 full 文档。协议子对象的替换粒度按当前 schema。

```ts
import { createClient, type Tier0Client, type UnsV2Request } from '@tier0/sdk-v2';

export async function renameSource(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  return client.source.documents.update({
    id, expectedRevision, patch: { name }, dryRun: false, idempotencyKey: intentKey,
  });
}
```

回执返回新的 Source view。无依赖时可直接变更；服务端要求 `SOURCE_IMPACT_CONFIRMATION_REQUIRED` 时，保持精确意图，按[影响分析](changes.md)取得完整结果。授权覆盖影响后使用真实 confirmedImpactRevision 提交，不增加例行人工确认。

```ts
import { createClient, type Tier0Client, type SourceDefinitionPatch, type UnsV2Request } from '@tier0/sdk-v2';

export async function updateSourceWithImpact(
  id: string, expectedRevision: UnsV2Request<'sourceImpact'>['expectedRevision'],
  patch: SourceDefinitionPatch, confirmedImpactRevision: string,
  intentKey: string, client: Tier0Client = createClient(),
) {
  return client.source.documents.update({
    id, expectedRevision, patch, confirmedImpactRevision,
    dryRun: false, idempotencyKey: intentKey,
  });
}
```

该函数只接收已核对的确认值，不自行评估并同意影响。更新不替换已发布 Stream 的 configRevision；需要切换时按任务更新绑定和发布。

## 轮换凭据

调用 `source.documents.credentials.update({id,expectedRevision,credentials,dryRun:false,idempotencyKey,...})`。新材料仍来自[只写导入](create.md)。存在依赖时以 `action:'credentials'` 评估影响，impact 不包含秘密，提交时携带对应 confirmedImpactRevision。

## 冲突与状态

版本冲突、确认过期或意图变化后重新读取并评估。修改请求或补充确认值属于新请求；原请求结局未知时先对账，不换键重做。

独立启停仅在 `stateManagementSupported` 与目标接口支持时使用 `documents.state.update`，携带当前修订和必要影响确认。停止某个消费者使用 Stream disable，不必停用共享 Source。
