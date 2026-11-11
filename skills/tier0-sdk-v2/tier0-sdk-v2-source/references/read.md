# 查询 Source 与诊断

| 需要的信息 | 方法 |
|---|---|
| 列表与安全摘要 | source.documents.list |
| 当前 revision | source.documents.get({id,view:'summary'}) |
| 完整连接文档 | source.documents.get({id,view:'full'}) |
| 运行状态 / 指定修订观测 | source.runtime.get / source.observations.get |
| 协议与实际资源 | source.protocols.list、source.discover、source.resources.catalog（按目标支持的入口） |
| 连接或有限数据检测 | source.probe |

列表 page 从 1 开始，按 hasMore/nextPage 翻页。摘要不含完整配置，不能直接写回为 document。已有创建或更新回执时可复用其 ID/revision，不必为每一步再次 get。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function* listSources(client: Tier0Client = createClient()) {
  let page = 1;
  while (true) {
    const { data } = await client.source.documents.list({ page, size: 100, includeDocument: false });
    yield data.list;
    if (!data.hasMore) return;
    if (typeof data.nextPage !== 'number' || data.nextPage <= page) throw new Error('Invalid next page');
    page = data.nextPage;
  }
}
```

Cloud 普通 HTTP 直接在绑定的 Stream 使用 source.request，不需要资源 catalog 前置检查。支持复用厂商认证的后端也允许同一厂商 Source 请求根下自定义路径；认证不由目录资源决定。命名厂商原生操作使用 discover，目录资源按返回的 configRevision、resourceRef、modes 和 schema 调用。

`probe` 会访问外部系统，按连接排障或有限数据验证的任务需要使用。健康状态、资源预览和业务采集成功是不同证据。保留连接检查与数据检查的各自阶段；配置变更后旧检查不能代表新版本。

ID 保持字符串；跨页不是稳定快照。权限拒绝、网络失败、资源不存在按结构化错误区分，不能把读取失败当作已删除。
