# HTTPServer 固定前缀与 Stream 路由

先用 [Source 创建](../../tier0-sdk-v2-source/references/create.md)保存 `http-api` + `config.role: server`。Source 使用 `http://managed` 和空 options；业务路径在 Stream 注册。

固定前缀为 `/ingest/v1/{workspaceId}/{sourceId}`。下例路由为 `POST /orders/:id`，完整请求路径为 `POST /ingest/v1/{workspaceId}/{sourceId}/orders/A-001`。前缀由部署环境和已认证的工作空间、Source 身份确定，不从请求 body 推断工作空间。Bearer 凭据由 Source 的既有管理合同取得并在调用时注入，不写入脚本。

## 保存原生程序草稿

使用完整原生 `document`：script 是 `{code,timeoutMs}`，sources 使用 alias。这与 `program` 的 script 字符串形态不同；不能把旧 Flow 脚本直接改名为新字段。

```ts
import { createClient, type Tier0Client, type CloudStreamDocument } from '@tier0/sdk-v2';

/** Save an HTTPServer route draft using the existing native Stream document contract. */
export async function createHttpServerStream(
  sourceId: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  if (!/^[1-9][0-9]*$/.test(sourceId)) throw new Error('Source ID 必须是正十进制字符串');
  const source = await client.source.documents.get({ id: sourceId, view: 'full' });
  if (!('document' in source.data)) throw new Error('需要完整 Source 文档');
  const config = source.data.document.config;
  if (source.data.document.protocol !== 'http-api' || config.role !== 'server') {
    throw new Error('此入站路由示例需要 HTTP API Server Source');
  }
  const document: CloudStreamDocument = {
    name, model: 'program',
    sources: [{ alias: 'incoming', sourceId, configRevision: source.data.revision, resources: [], acquisition: {} }],
    script: { timeoutMs: 5000, code: [
      'module.exports = api => {',
      '  const server = api.sources.use("incoming");',
      '  api.stream.onRequest({ id: "orders", source: server, method: "POST", path: "/orders/:id" }, ctx => {',
      '    return { status: 200, body: { orderId: ctx.request.params.id, payload: ctx.request.body } };',
      '  });',
      '};',
    ].join('\n') },
  };
  const saved = await client.stream.documents.create({ dryRun: false, document, idempotencyKey: intentKey });
  if (!('id' in saved.data)) throw new Error('创建未返回已保存的草稿');
  return { receipt: saved, current: saved.data };
}
```

此函数只读取 Source 并保存草稿；发布按[部署](deploy.md)使用回执的 revision，只有实际发布运行后才可调用路由。示例返回请求的参数和 body，不写入 UNS。`ctx.request` 由执行宿主构造；`source` 引用限定 HTTPServer，不能换成 Client 主动请求。

普通 handler 返回 `{status,headers?,body?}` 时，宿主等待处理和提交完成才发送响应。需要先回复再处理时，在 HTTP `onRequest` handler 中调用一次 `await ctx.reply({status,headers?,body?})`，随后继续执行；见下例。

## 先回复，再写入集合

目标环境必须部署支持 `ctx.reply` 的新 Stream 执行器。传入已有且允许当前 Stream 写入的 Collection ID；请求 body 必须符合其 Record schema。Source 仍是同一种 HTTPServer，不增加 Source 模式。

```ts
import { createClient, type Tier0Client, type CloudStreamDocument } from '@tier0/sdk-v2';

/** Save an HTTPServer draft that acknowledges before its bounded Stream work. */
export async function createHttpServerEarlyReplyStream(
  sourceId: string, collectionId: string, name: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  if (!/^[1-9][0-9]*$/.test(sourceId)) throw new Error('Source ID 必须是正十进制字符串');
  if (!collectionId) throw new Error('需要实际 Collection ID');
  const source = await client.source.documents.get({ id: sourceId, view: 'full' });
  if (!('document' in source.data)) throw new Error('需要完整 Source 文档');
  const config = source.data.document.config;
  if (source.data.document.protocol !== 'http-api' || config.role !== 'server') {
    throw new Error('此入站路由示例需要 HTTP API Server Source');
  }
  const document: CloudStreamDocument = {
    name, model: 'program',
    sources: [{ alias: 'incoming', sourceId, configRevision: source.data.revision, resources: [], acquisition: {} }],
    script: { timeoutMs: 5000, code: [
      'module.exports = api => {',
      '  const server = api.sources.use("incoming");',
      '  const output = api.uns.use({ collectionId: ' + JSON.stringify(collectionId) + ', access: "write" });',
      '  api.stream.onRequest({ id: "orders", source: server, method: "POST", path: "/orders/:id" }, async ctx => {',
      '    await ctx.reply({ status: 202, body: { accepted: true, orderId: ctx.request.params.id } });',
      '    await output.write({ recordId: ctx.request.params.id, record: ctx.request.body });',
      '  });',
      '};',
    ].join('\n') },
  };
  const saved = await client.stream.documents.create({ dryRun: false, document, idempotencyKey: intentKey });
  if (!('id' in saved.data)) throw new Error('创建未返回已保存的草稿');
  return { receipt: saved, current: saved.data };
}
```

`ctx.reply` 只用于 HTTP `api.stream.onRequest`，一次执行只回复一次；不要在 `every`或普通事件 handler 中调用，也不增加 npm App API 或公开 HTTP endpoint。示例先发 202 再写 Record，202 表示已回复接受，不能报告写入或提交成功；失败通过 Stream 运行记录检查，不能再发送第二份响应。

回复后的处理仍受 Stream timeout（本例 5000 ms）、并发上限和实时权限约束。客户端断线不会取消已回复后的执行，服务 shutdown 仍可取消。进程崩溃不保证重放；业务若需持久投递、去重或恢复，必须另行设计，不能把 `ctx.reply` 当作持久队列。凭据和权限均沿用现有 Source/Stream 合同。
