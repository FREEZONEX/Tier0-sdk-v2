# 创建 Stream

方法：`stream.documents.create({program})`；POST `/openapi/v2/uns/streams/documents/create`。服务端编译并校验程序，回执包含完整草稿和修订，可直接用于下一步发布。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| dryRun | boolean | 是 | true 预检，false 保存草稿 |
| program.name | string | 是 | 1–63 字符 |
| program.sdkVersion | tier0-stream/v2 | 是 | 运行时脚本版本 |
| program.script | string | 是 | 完整 module.exports 程序 |
| program.timeoutMs | integer | 否 | 当前云端上限 30000 ms |
| program.sourceBindings | array | 否 | sourceId、configRevision、acquisition |
| idempotencyKey | string | 否 | 最多 128 字符，本次创建的固定意图键 |

## HTTP Client Source 绑定示例

先按[Source 查询](../../tier0-sdk-v2-source/references/read.md)选定真实 HTTP Client Source。脚本的 api.sources 属于平台执行器，与应用中的 client.source 不同。sourceId 保持字符串，configRevision 从完整源读取。省略 `config.role` 时按正式协议目录默认为 client；Server 走入站语义，不能创建为主动请求程序。

```ts
import { createClient, type Tier0Client, type RuntimeStreamDefinition } from '@tier0/sdk-v2';

export async function createHttpStream(
  sourceId: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  if (!/^[1-9][0-9]*$/.test(sourceId)) throw new Error('Source ID 必须是正十进制字符串');
  const source = await client.source.documents.get({ id: sourceId, view: 'full' });
  if (!('document' in source.data)) throw new Error('需要完整 Source 文档');
  if (source.data.document.protocol !== 'http-api' || source.data.document.config.configVersion !== 2 ||
      (source.data.document.config.role ?? 'client') !== 'client') {
    throw new Error('此主动请求示例需要 HTTP API Client Source');
  }
  const document: RuntimeStreamDefinition = {
    name, sdkVersion: 'tier0-stream/v2', timeoutMs: 5000,
    sourceBindings: [{ sourceId, configRevision: source.data.revision, acquisition: {} }],
    script: [
      'module.exports = api => {',
      '  const upstream = api.sources.use({ id: ' + JSON.stringify(sourceId) + ', resources: [] });',
      '  api.stream.every({ id: "tick", intervalMs: 60000 }, async () => {',
      '    const response = await upstream.request({ method: "GET", path: "orders" });',
      '    return response.data;',
      '  });',
      '};',
    ].join('\n'),
  };
  const saved = await client.stream.documents.create({
    dryRun: false, program: document, idempotencyKey: intentKey,
  });
  if (!('id' in saved.data)) throw new Error('创建未返回已保存的草稿');
  return { receipt: saved, current: saved.data };
}
```

将 path="orders"、60 秒周期改为业务实际值。示例保存草稿，不部署，也不将返回值自动写入 UNS；需要写入集合时按执行器能力定义 api.uns 操作。resources=[] 是空冻结资源集，不是通配授权。源地址和凭据留在 Source，不能拷进 acquisition 或脚本。

创建 data 为 CloudStreamDocumentView 或预检结果，实际保存返回 id、revision 和完整 document；预检不生成 ID。需要展示预检时单独调用 documents.validate({program})；普通保存无需先校验再保存。当前后端创建/校验需要注册 Worker 可用。TEMPORARILY_UNAVAILABLE 不代表脚本一定错误；不要自动改用旧 Flow。

programs.create 已退役，创建统一使用 documents.create。历史创建结局未知时先按已知 ID 或业务标识核对状态，不能将旧请求或幂等键改投 documents.create 重做。

原生编辑器形态 `documents.create({dryRun, document})` 的 document 为 name/model/script对象/sources/entries，script 为 `{sdkVersion,code,timeoutMs}`，sources 用 alias/sourceId/configRevision/resources/acquisition。不要把上面的 script 字符串直接塞入原生文档。
