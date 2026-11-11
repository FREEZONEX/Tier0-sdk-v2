# HTTPServer 路由

HTTPServer Source 使用 `protocol:'http-api'`、`role:'server'`、endpoint `http://managed`。Stream 注册业务 method/path；入口前缀由部署环境与身份确定，为 `/ingest/v1/{workspaceId}/{sourceId}`。调用凭据由 Source 管理，不放脚本。

原生 document 与 program 都使用 script 对象；以下保存草稿，后续按 [deploy](deploy.md) 发布：

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function createHttpServerStream(
  sourceId: string, sourceRevision: number, name: string, intentKey: string,
  client: Tier0Client = createClient(),
) {
  return client.stream.documents.create({
    dryRun:false,idempotencyKey:intentKey,
    document:{name,model:'program',sources:[{alias:'incoming',sourceId,configRevision:sourceRevision,resources:[]}],
      script:{timeoutMs:5000,code:`module.exports = api => {
        const server = api.sources.use('incoming');
        api.stream.onRequest({id:'orders',source:server,method:'POST',path:'/orders/:id'}, ctx => {
          return {status:200,body:{orderId:ctx.request.params.id}};
        });
      };`}},
  });
}
```

使用实际 HTTPServer Source 的 ID/修订。示例响应请求，不写 Collection；完整路径如 `/ingest/v1/{workspaceId}/{sourceId}/orders/A-001`。它与带公开 request 合同、由 App 调用的 onRequest 不同。

普通返回 `{status,headers?,body?}` 在处理与提交完成后响应。需要提前回复时，HTTP handler 可调用一次 `await ctx.reply({status:202,body:{accepted:true}})` 再继续处理；202 只表示已接受，后续写入结果仍查运行记录。

提前回复后仍受脚本超时和并发限制，不能再次回复。客户端断线不等于取消，服务关闭仍可取消，崩溃不保证重放；需要持久投递时使用对应业务机制，不能把 ctx.reply 当消息队列。
