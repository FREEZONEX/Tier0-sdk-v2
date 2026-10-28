import { createClient, type Tier0Client, type CloudStreamDocument } from '@tier0/sdk-v2';

/** Save an HTTPServer route draft using the existing native Stream document contract. */
export async function createHttpServerStream(
  sourceId: string, name: string, intentKey: string, client: Tier0Client = createClient(),
) {
  if (!/^[1-9][0-9]*$/.test(sourceId)) throw new Error('Source ID 必须是正十进制字符串');
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
