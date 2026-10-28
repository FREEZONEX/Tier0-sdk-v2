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
  if (source.data.document.protocol !== 'http-api' || config.configVersion !== 2 || config.role !== 'server') {
    throw new Error('此入站路由示例需要 HTTP API Server Source');
  }
  const document: CloudStreamDocument = {
    name, model: 'program',
    sources: [{ alias: 'incoming', sourceId, configRevision: source.data.revision, resources: [], acquisition: {} }],
    script: { sdkVersion: 'tier0-stream/v2', timeoutMs: 5000, code: [
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
