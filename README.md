# @tier0/sdk-v2

Tier0 云端新架构的独立 TypeScript / JavaScript SDK。新仓库、新 npm 包，不覆盖 `@tier0/sdk`。

当前版本 `0.1.0` 是待联调的首版源码，尚未发布 npm，也不表示开发环境已部署对应后端。要求 Node.js 20.19+。浏览器 HTTP、MQTT、React、Vue 和服务端身份验签分别提供独立入口。

## 安装与初始化

首发前在本仓库运行 `npm ci`、`npm run check`、`npm pack`，业务项目安装生成的 `.tgz`。发布后使用：

```sh
npm install @tier0/sdk-v2
```

```ts
import { createClient } from '@tier0/sdk-v2';

// 服务端环境注入 TIER0_API_HOST 和 TIER0_API_KEY。
const tier0 = createClient();
const user = await tier0.system.whoami();
const platform = await tier0.system.info();
const capabilities = await tier0.capabilities.discover();
```

也可显式配置 `{ apiHost, apiKey, transportTimeoutMs, fetch }`，或提供 `getApiHost` / `getApiKey` 回调。裸域名默认使用 HTTPS；本地 HTTP 测试请显式写 `http://127.0.0.1:端口`。不自动向浏览器注入或读取 `VITE_` API Key。

`createClient()` 实例之间不共享配置；推荐在一个稳定身份的服务生命周期内复用实例。员工数据委托必须为每个请求创建新实例，传入受信网关的 `unsV2AppDataSubject`。App Key 只代表 App，不能替代当前用户身份，也不能下发到浏览器。浏览器页面应调用自己的服务端 API。

## 能力与入口

| 入口 | 能力 |
| --- | --- |
| `tier0.source` | 数据源、连接文档、影响分析、版本历史与运行观测 |
| `tier0.stream` | Runtime programs、原生文档、校验、部署、回滚与运行记录 |
| `tier0.uns` | 目录、Topic、Collection、Record、Sample、事务与 App 数据上下文 |
| `tier0.system` | `whoami()`、`info()` |
| `tier0.members` | `listWorkspace()`；没有虚构 App 成员接口 |
| `tier0.notifications` | `send()`、`get()` |
| `tier0.files` | `upload()`、`uploadMultipart()`、`url()`、`download()`、`delete()`、`multipart` 原子接口 |
| `tier0.mqttAuth` | 创建、删除 MQTT 凭证 |
| `tier0.agent` | `analyses`、`canvases`、`cards`、`jobs`、`jobRuns`、`library`、`nodes`、`relations`、`results` |
| `tier0.capabilities` | 当前凭证可见的能力发现；就绪状态由服务端判断 |
| `tier0.controls` | Control 发现、描述、执行及结果未知错误 |
| `tier0.api` | 50 个普通 OpenAPI 的完整生成接口；通常优先使用上面的领域入口 |
| `@tier0/sdk-v2/mq` | MQTT WebSocket 客户端与 broker 地址工具；不进入根入口依赖图 |
| `@tier0/sdk-v2/source` | `createSourceClient()`，独立 Source 客户端 |
| `@tier0/sdk-v2/stream` | `createStreamClient()`，独立 Stream 客户端 |
| `@tier0/sdk-v2/react` | `useTier0Query()`、`useTier0Mutation()`，需要 React 和 TanStack Query |
| `@tier0/sdk-v2/vue` | `useTier0Request()`，需要 Vue 3 |
| `@tier0/sdk-v2/server` | `createCloudAppRequestVerifier()`，仅服务端加载 `node:crypto` |

不保留 UNS v1、旧 Flow、`getCurrentProjectId()`、project 成员查询或 `/gw/reload`。Workspace 成员不等于能使用某个 App 的成员，不可用前者在客户端猜测 App 权限。

## Source、Stream 与 UNS 分域

Source 负责连接外部系统，Stream 负责处理与运行，UNS 负责命名空间与业务数据。共用底层 98 个公开生成操作，业务入口按领域组织；Control 使用 `tier0.controls` 的专属契约。

```ts
const sources = await tier0.source.documents.list({ page: 1, size: 20 });
const programs = await tier0.stream.programs.list({ page: 1, size: 20 });
const runtime = await tier0.stream.runtime.capabilities({});
```

Source/Stream 仍保留 `{ code, msg, requestId, data }` 响应以及 `UnsV2Error` 错误类型。`source.documents` 是云端原生文档，`source.create/validate` 等是通用投影；`stream.programs` 与 `stream.documents` 使用不同文档结构，不可混用。保存、部署、运行成功分别判断。

从最初提交迁移：`uns.sourceList` → `source.list`；`uns.sourceDocumentGet` → `source.documents.get`；`uns.streamProgramDeploy` → `stream.programs.deploy`；`uns.streamDocumentValidate` → `stream.documents.validate`。这些管理方法已移出主入口的 `uns`。底层 `createUnsV2Client()` 仍提供完整生成契约供契约工具使用；数据专用客户端可用 `createUnsDataClient()`。

随包提供 11 个可独立发现的 Skill，包含完整流程、参数边界、错误处理与可类型检查的示例：[入口](skills/tier0-sdk-v2/SKILL.md)、[Source](skills/tier0-sdk-v2-source/SKILL.md)、[Stream](skills/tier0-sdk-v2-stream/SKILL.md)、[UNS](skills/tier0-sdk-v2-uns/SKILL.md)、[通知](skills/tier0-sdk-v2-notifications/SKILL.md)、[系统](skills/tier0-sdk-v2-system/SKILL.md)、[文件](skills/tier0-sdk-v2-files/SKILL.md)、[MQTT](skills/tier0-sdk-v2-mq/SKILL.md)、[成员](skills/tier0-sdk-v2-members/SKILL.md)、[Controls](skills/tier0-sdk-v2-controls/SKILL.md)、[Agent](skills/tier0-sdk-v2-agent/SKILL.md)。复杂流程的参考文档随 Skill 一起打包。

## UNS 数据访问

```ts
const context = await tier0.uns.dataAppContext({});
const page = await tier0.uns.recordFind({ collectionId: 'orders', limit: 20 });
const records = page.data;

const controller = new AbortController();
await tier0.uns.recordFind(
  { collectionId: 'orders', limit: 20 },
  { signal: controller.signal },
);
```

实际集合 ID 和有效权限从平台配置/数据上下文取得。SDK 中存在创建集合的方法，不表示 App 数据 Key 有管理权限；后台内部管理接口不导出到公开 SDK。

UNS 保留 `{ code, msg, requestId, data }` 完整响应。普通 v1 包装接口返回已解包的 `data`，通知/Control/能力发现返回服务端直接对象。业务错误即使 HTTP 为 200 也会抛出 `ApiError`。

`int64` 和普通 v1 整数字段使用 `number | bigint`：安全范围内返回 number，超出范围返回 bigint。UNS 任意 JSON 中无法无损表示的数字用 `UnsV2RawNumber`；传回 SDK 可保持原值。对外输出 JSON 时自行确定 bigint/精确数字的表示，不要直接 `JSON.stringify` 包含这些值的对象。

HTTP 操作不自动重试。`UnsV2OutcomeUnknownError`、`ControlResultUnknownError` 或 `ApiError.outcomeUnknown` 表示写操作可能已执行；先查询结果/作业，按业务意图保留原幂等键，不自动生成新键重放。查询与写入均可受配置超时约束。

## 通知

```ts
import { getCurrentAppId } from '@tier0/sdk-v2';

await tier0.notifications.send({
  recipientUserId: '目标用户ID',
  type: 'business',
  title: '工单已完成',
  content: '请查看处理结果。',
  idempotencyKey: 'work-order-123-completed',
  sender: { type: 'app', id: getCurrentAppId() },
});
```

不传 `channels` 时发送 `['web', 'mobile']`；`web` 包含 Web 与 Desktop；`[]` 只创建站内信。重复值去重，显式单渠道不补齐，不接受 `desktop`。App 身份读取平台注入的真实 `APP_ID`，不依赖 Folder 或 project。

## 文件

```ts
const saved = await tier0.files.upload(new File(['report'], 'report.txt'));
const stableReference = saved.filePath;
const { fileUrl } = await tier0.files.url({ filePath: stableReference });
const response = await tier0.files.download({ filePath: stableReference });
const bytes = await response.arrayBuffer();
```

保存 `filePath`，不把临时签名地址当作持久化引用。上传由平台签发地址后直传对象存储，平台 API Key 不传到存储域名；下载先获取签名地址，再匿名获取文件，避免认证重定向泄漏凭证。

超过 100 MiB 自动使用分片上传，也可调用 `uploadMultipart(file, { partSize, signal, onProgress })`。首版顺序上传分片，不自动重试。中断后 `MultipartUploadError.session` 保留 uploadId、fileKey、已完成 parts 和 `completionAttempted`，可以通过 `files.multipart` 完成或终止；尝试过 complete 后必须先核对结果。未实现自动断点续传。

返回的下载 `Response` 由调用方消费；文件传输配置超时约束取得响应头的阶段，后续流式读取由调用方管理。所有业务附件、头像、导入/导出文件使用平台文件存储，不以 App 本地目录作为持久化存储。

## MQTT

```ts
import { Tier0MQClient, toWebSocketUrl } from '@tier0/sdk-v2/mq';

const info = await tier0.system.info();
const credentials = await tier0.mqttAuth.create({ name: 'integration-client' });
const mq = new Tier0MQClient({
  host: toWebSocketUrl(info.mqttBroker),
  clientId: credentials.clientID,
  username: credentials.username,
  password: credentials.password,
});
await mq.connect();
mq.subscribe('平台授权的主题', (_topic, payload) => { /* 处理消息 */ });
```

完整凭证只在创建时返回一次。也支持从编码 Workspace 的平台 API Key 推导 MQTT 身份；无法解析的 Key 会拒绝连接，不回退到 Enterprise 身份。MQTT 自身的连接恢复/QoS 语义与 HTTP 的“不自动重试写入”是不同机制。

## React / Vue

```ts
import { useTier0Query, useTier0Mutation } from '@tier0/sdk-v2/react';

const orders = useTier0Query(tier0, ['orders'], (client, signal) =>
  client.uns.recordFind({ collectionId: 'orders' }, { signal }));
const send = useTier0Mutation(tier0, (client, body: Parameters<typeof tier0.notifications.send>[0]) =>
  client.notifications.send(body));
```

React 需要 `QueryClientProvider`。保持客户端实例稳定；查询缓存按实例隔离，不跨凭证共享。查询 hook 只用于读取，写操作用 mutation。框架入口不会自动重试。

```ts
import { useTier0Request } from '@tier0/sdk-v2/vue';
const orders = useTier0Request(tier0, (client, collectionId: string, signal) =>
  client.uns.recordFind({ collectionId }, { signal }));
await orders.execute('orders');
```

Vue 由 `execute()` 显式执行，后发请求的结果优先；取消不表示服务端写入已撤销。

## 契约更新与验证

上游：`FREEZONEX/Tier0-Backend`，固定提交 `1e93620522caa47869d67e9aea1491a8cda71fa5`。`contracts/upstream.json` 记录来源和 SHA-256。

```sh
npm ci
npm run check

# 更新时显式提供后端 checkout 与已提交版本；不会自动读取工作区未提交修改。
npm run sync:contracts -- ../Tier0-Backend <commit>
npm run generate
npm run check
```

v1 来自网关 Swagger，并按实际 handler 补齐响应外层；UNS 来自 `contract_generated.go#ContractJSON` 中已经应用 Cloud 扩展的契约，结合 manifest/registry 生成。不能直接使用仍含 Enterprise 基础操作的 `share/unscontract/contract.json` 作为最终云端契约。

`npm run check` 包含契约一致性、Skill 注册及递归引用检查、所有 Skill TypeScript 示例的源码/安装包类型校验、单元和本地 HTTP 测试、ESM/CJS 构建、实际 npm 包安装、浏览器打包及导入验证。`tests/skill-workflows.test.ts` 直接提取 Markdown 示例，验证 Source/Stream/UNS 的创建、查询、修改、删除或归档恢复，影响分页和结果未知分支，以及通知请求、状态查询和成员展示。测试不调用线上写接口，也不证明真实环境功能已上线。

首发前仍需：目标环境只读联调、隔离测试空间的写入验收、App 脚手架切换精确依赖 `"@tier0/sdk-v2": "0.1.0"`、新 Skill 上传和 npm 发布授权。App 成员能力等待公开 appId 契约落地后增加，现阶段不承诺该能力。
