# 创建 Stream

`client.stream.documents.create` 保存草稿，不自动发布。传互斥的 `program` 或 `document`；dryRun 默认为 false，true 仅预检。已有 Source 回执和目标 Collection 时直接复用，不增加固定 probe/validate 步骤。

## 周期 HTTP 采集示例

Source 为通用 HTTP client，保存基址和认证。按上游合同调整 path、分页、周期和数据映射；本例只处理最多 40 条的单批，不表示全量采集。

```ts
import { createClient, type Tier0Client, type CloudSourceDocumentView } from '@tier0/sdk-v2';

export async function createHttpStream(
  source: CloudSourceDocumentView, collectionId: string, name: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  if (source.document.protocol !== 'http-api' || 'sourceType' in source.document ||
      (source.document.role ?? 'client') !== 'client') throw new Error('Generic HTTP client Source required');
  const code = `module.exports = api => {
    const upstream = api.sources.use({id:${JSON.stringify(source.id)},resources:[]});
    const output = api.uns.use({collectionId:${JSON.stringify(collectionId)},access:'write'});
    api.stream.onTimer({id:'inventory',intervalMs:60000}, async () => {
      const response = await upstream.request({method:'GET',path:'inventory',query:{limit:'40'}});
      if (response.status !== 200 || !Array.isArray(response.data) || response.data.length > 40) throw Error('Invalid inventory response');
      const seen = new Set();
      const records = response.data.map(row => {
        if (!row || typeof row.sku !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(row.sku) ||
            seen.has(row.sku) || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity)) throw Error('Invalid inventory row');
        seen.add(row.sku);
        return {recordId:row.sku,record:{sku:row.sku,quantity:row.quantity}};
      });
      for (const record of records) await output.write(record);
    });
  };`;
  return client.stream.documents.create({
    dryRun:false, idempotencyKey:intentKey,
    program:{name,script:{code,timeoutMs:10000},sourceBindings:[{sourceId:source.id,configRevision:source.configRevision ?? source.revision,acquisition:{}}]},
  });
}
```

目标 Collection schema 包含 sku 和 quantity，稳定键应按实际业务粒度确定；含仓库/批次的库存不能只用 SKU 覆盖。`source.request` 非 2xx 不自动抛错，先检查状态与整批格式，再缓冲输出。不要将响应正文、URL 或认证头写入异常。

脚本入口 ID 和 alias 为小写稳定标识：`^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`，最长 64 字符。recordId 规则不同，见 [Collection](../../tier0-sdk-v2-uns/SKILL.md)。脚本最大 30000 ms；大批次按来源分页并将 checkpoint 与业务输出一并提交，不在单次运行里无限循环。

## 绑定与后续步骤

- program 推荐用 sourceBindings 的 sourceId/configRevision/acquisition，也可用带 alias/resources 的 sources，二者互斥；原生 document 使用 sources。取 Source 返回的 configRevision；旧 Cloud 本地文档缺少该字段时才沿用其 revision，不用本地文档修订推算远端配置修订。script 始终为 `{code,timeoutMs}`，不是字符串。
- 远端绑定可用 `target:{fleetNodeId,sourceId,configRevision}` 替代本地 sourceId/configRevision。使用发现得到的节点身份；target 只选址，不放凭据，不手工拼 edge:// 引用。
- 检查返回 data 是含 id/revision/document 的已保存草稿，再交给 [发布](deploy.md)。dryRun 结果不产生可发布的新草稿。
- 静态校验和 isolated-sample 不执行所有动态请求。发布后按实际入口查看运行并读回业务记录，见 [验收](lifecycle.md)。

Source 创建和凭据格式见 [Source 创建](../../tier0-sdk-v2-source/references/create.md)。
