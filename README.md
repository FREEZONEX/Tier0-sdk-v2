# @tier0/sdk-v2

Tier0 云端新架构的独立 TypeScript / JavaScript SDK。新仓库、新 npm 包，不覆盖 `@tier0/sdk`。

当前源码准备 `0.4.0`，尚未发布 npm。相对 0.3.x 移除已退役的 Stream 就绪探针且不保留别名，改用服务端现有统一权限，不再配置逐 Key Control scopes/codes。0.3.0 起统一使用 OpenAPI v2 并退役重复及旧接口；与 0.2.x 存在不兼容变更，迁移方式见下方“本次接口退役”。对应 UNS v2 契约 5.0.0，与 0.1.0 不兼容（新错误模型 `execution` / `retry`、封顶计数、删除 `recordChangesPoll` 等）。Collection 支持 int、float、double 和 datetime 声明；格式注解不新增数值范围或日期格式校验，Sample 外层 time 保持不变。使用时需确认目标环境已部署对应后端。要求 Node.js 20.19+。浏览器 HTTP、MQTT、React、Vue 和服务端身份验签分别提供独立入口。

本次合同固定到已部署 Backend `6cb53b80`，同步请求统一权限、移除旧探针，并保留该版本 Source discovery 的副作用分类及不自动重试语义。

既有接口收敛：平台接口统一迁移到 `/openapi/v2`，Controls 使用 `/openapi/v2/uns/controls/*`；移除 21 个重复 UNS 入口和旧 Agent nodes/relations 方法。完善 Source 操作、Stream 发布回执及 UNS 创建快照的使用说明，保留精确发布编号和完整文档访问规则。

## 安装与初始化

发布前在本仓库运行 `npm ci`、`npm run check`，验证生成的 `.tgz`。发布前业务项目安装验证生成的 `.tgz`；正式发布后安装精确版本：

```sh
npm install --save-exact @tier0/sdk-v2@0.4.0
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
| `tier0.members` | `listWorkspace()` 用于 Workspace 级成员选择；`listApp({ appId })` 查询能使用指定 App 的成员 |
| `tier0.notifications` | `send()`、`get()` |
| `tier0.files` | `upload()`、`uploadMultipart()`、`url()`、`download()`、`delete()`、`multipart` 原子接口 |
| `tier0.mqttAuth` | 创建、删除 MQTT 凭证 |
| `tier0.agent` | `analyses`、`canvases`、`cards`、`jobs`、`jobRuns`、`library`、`results` |
| `tier0.capabilities` | 当前凭证可见的能力发现；就绪状态由服务端判断 |
| `tier0.controls` | Control 发现、描述、执行及结果未知错误 |
| `tier0.api` | 44 个平台 OpenAPI v2 的完整生成接口；通常优先使用上面的领域入口 |
| `@tier0/sdk-v2/mq` | MQTT WebSocket 客户端与 broker 地址工具；不进入根入口依赖图 |
| `@tier0/sdk-v2/source` | `createSourceClient()`，独立 Source 客户端 |
| `@tier0/sdk-v2/stream` | `createStreamClient()`，独立 Stream 客户端 |
| `@tier0/sdk-v2/react` | `useTier0Query()`、`useTier0Mutation()`，需要 React 和 TanStack Query |
| `@tier0/sdk-v2/vue` | `useTier0Request()`，需要 Vue 3 |
| `@tier0/sdk-v2/server` | `createCloudAppRequestVerifier()`，仅服务端加载 `node:crypto` |
| `@tier0/sdk-v2/data` | App 数据层：`defineCollection()` 声明集合（含 TTL）、`createDataClient()` 首次访问时 ensure，Mongo 风格读写、带总数分页与封顶计数、原子批量与 `transact`、`subscribe` 变更订阅、员工数据主体透传；自动幂等键、并发上限与按 `retry.safe` 重试；仅服务端，需要 `zod` 4 |
| `@tier0/sdk-v2/data/define` | 集合声明与类型：`defineCollection()`、`Doc` / `NewDoc` 等、`compileCollection()`、`validateDocument()`；可进浏览器包，组件和 route 的客户端代码只从这里取声明和类型 |

不保留 UNS v1、旧 Flow、`getCurrentProjectId()`、project 成员查询或 `/gw/reload`。Workspace 成员不等于能使用某个 App 的成员，不可用前者在客户端猜测 App 权限。

## 本次接口退役

HTTP 调用统一使用 `/openapi/v2`。21 个重复 UNS 公共入口及生成方法直接移除，没有旧路由回退；升级 SDK 时需同时部署对应后端。

- Source 的 list/get/create/update、connection.update 改用 documents.*；Stream 的 programs.get/create/update/validate/disable 改用 documents.*，停用同时携带 expectedRevision 与 expectedActiveRelease。
- 低层 findOneAnd* 改用 updateOne/replaceOne/deleteOne 的 returnDocument；批量新增用 bulkWrite 的 insertOne 项；元数据单条读取用 metadataFind + limit:1，去重用 aggregate。
- App 数据层的 insertMany、findOneAnd*、distinct 等便捷方法保留，由 SDK 映射到当前入口；insertMany 仍是单次原子请求，最多 200 项。
- Agent 的旧 nodes.searchSemantic/indexSync 和 relations.list/teach 没有 v2 契约，不再导出。Controls 使用 `/openapi/v2/uns/controls/*`，错误保留 execution/retry/requestId，且不会自动重试。

升级前应核对旧写请求的最终结果，包括集合初始化 seed。退役入口不再可调用，不能将未知结果的旧请求或幂等键直接改投新入口重做。当前入口的重试仍保留原路径、原键和原载荷。

## Source、Stream 与 UNS 分域

Source 负责连接外部系统，Stream 负责处理与运行，UNS 负责命名空间与业务数据。公开操作由固定的上游契约生成，业务入口按领域组织；Control 使用 `tier0.controls` 的专属契约。目录、Topic、集合基础 CRUD 统一使用 `metadata*`，查询、批量操作、软删除及恢复见 UNS Skill。

```ts
const sources = await tier0.source.documents.list({ page: 1, size: 20 });
const programs = await tier0.stream.programs.list({ page: 1, size: 20 });
```

Source/Stream 仍保留 `{ code, msg, requestId, data }` 响应以及 `UnsV2Error` 错误类型。Source 配置统一使用 `source.documents`；Stream 草稿统一通过 `stream.documents` 创建、读取、校验和修改，输入 `program` 与 `document` 二选一。发布和回滚仍走 `stream.programs`。保存、部署、运行成功分别判断。

旧 `stream.runtime.capabilities()` 及底层 `streamRuntimeCapabilitiesGet` 已退役，没有兼容别名；不要把该查询当作 Stream 前置检查，也不要为消除它的 403 增加 Control scope 或逐 Key 的控制码授权。Stream 管理、实际执行、发布、回滚及运行记录继续通过各自接口和统一权限校验；通用能力发现不代替实际操作结果。

- 已知 Source ID/revision 且没有 Stream 引用时，可 [直接 patch 或变更状态](skills/tier0-sdk-v2/tier0-sdk-v2-source/references/update.md)；有引用时仍按精确意图确认影响。
- Stream 创建/更新回执的 revision 可直接用于发布；[发布回执](skills/tier0-sdk-v2/tier0-sdk-v2-stream/references/deploy.md) 的 activeRelease 用于观察这次发布，无需前后各查询一次。
- 单条 Record 新增可用 [returnDocument:'after'](skills/tier0-sdk-v2/tier0-sdk-v2-uns/references/create.md) 同次取得创建快照；[App 数据层](skills/tier0-sdk-v2/tier0-sdk-v2-data/references/read-write.md) 支持相同选择及投影类型。

从最初提交迁移：`uns.sourceList` → `source.documents.list`；`uns.sourceDocumentGet` → `source.documents.get`；`uns.streamProgramDeploy` → `stream.programs.deploy`；`uns.streamDocumentValidate` → `stream.documents.validate`。这些管理方法已移出主入口的 `uns`。底层 `createUnsV2Client()` 仍提供完整生成契约供契约工具使用；数据专用客户端可用 `createUnsDataClient()`。

随包提供 Skill：总入口 [tier0-sdk-v2](skills/tier0-sdk-v2/SKILL.md) 下嵌套 11 个领域子 Skill（`skills/tier0-sdk-v2/tier0-sdk-v2-<领域>/`），每个仍可独立发现，包含完整流程、参数边界、错误处理与可类型检查的示例：[Source](skills/tier0-sdk-v2/tier0-sdk-v2-source/SKILL.md)、[Stream](skills/tier0-sdk-v2/tier0-sdk-v2-stream/SKILL.md)、[UNS](skills/tier0-sdk-v2/tier0-sdk-v2-uns/SKILL.md)、[通知](skills/tier0-sdk-v2/tier0-sdk-v2-notifications/SKILL.md)、[系统](skills/tier0-sdk-v2/tier0-sdk-v2-system/SKILL.md)、[文件](skills/tier0-sdk-v2/tier0-sdk-v2-files/SKILL.md)、[MQTT](skills/tier0-sdk-v2/tier0-sdk-v2-mq/SKILL.md)、[成员](skills/tier0-sdk-v2/tier0-sdk-v2-members/SKILL.md)、[Controls](skills/tier0-sdk-v2/tier0-sdk-v2-controls/SKILL.md)、[Agent](skills/tier0-sdk-v2/tier0-sdk-v2-agent/SKILL.md)、[App 数据](skills/tier0-sdk-v2/tier0-sdk-v2-data/SKILL.md)。复杂流程的参考文档随 Skill 一起打包。在 Tier0 Console 上传时，把整个 `skills/tier0-sdk-v2/` 目录打成一个 zip。

## UNS 数据访问

新建 Schema 的数值字段使用明确格式：整数为 `type: 'integer', format: 'int32'`，小数为 `type: 'number', format: 'double'`，明确需要单精度时指定 `format: 'float'`。App 数据层编译 Zod 声明时，会递归为未指定格式的 integer/number 补齐 int32/double，并保留显式格式；直接调用 UNS/MCP 时由调用方提供 format。这些是类型注解，不新增数值范围或舍入规则；ensure 不改写已有字段注解，已有 legacy 字段需通过 schema:replace 单独迁移。

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

实际集合 ID 和有效权限从平台配置/数据上下文取得。管理操作中，App 凭证只能调用本 App 集合的 `appCollectionsEnsure` / `appCollectionsSchemaReplace` / `appCollectionsArchive` / `appCollectionsRestore`；SDK 中存在 `metadataInsertOne` 等其他管理方法，不表示 App 凭证有对应权限。App 数据授权 `appDataPolicyGet` / `appDataPolicyUpdate` 的调用方必须是：持有 `uns.write` 的登录会话、持有 `uns.write` 且 full_access、不绑定 App 的 personal / agent Key，或治理会话；运行时 App 凭证不能管理授权。Core-only 后台接口不导出到公开 SDK。

UNS 保留 `{ code, msg, requestId, data }` 完整响应。平台 v2 包装接口返回已解包的 `data`，通知/能力发现返回直接对象，Control 外观解包 UNS 回执并保留直接结果对象。业务错误即使 HTTP 为 200 也会抛出 `ApiError`。

`int64` 和平台整数字段使用 `number | bigint`：安全范围内返回 number，超出范围返回 bigint。UNS 任意 JSON 中无法无损表示的数字用 `UnsV2RawNumber`；传回 SDK 可保持原值。对外输出 JSON 时自行确定 bigint/精确数字的表示，不要直接 `JSON.stringify` 包含这些值的对象。

`createClient()` 的 HTTP 操作不自动重试。UNS v2 错误带 `execution`（`notStarted` / `rolledBack` / `committed` / `unknown`）与 `retry: { safe, afterMs? }`：`safe` 表示可以用同一请求（同一幂等键）重发。`execution` 为 `unknown` 时抛出 `UnsV2OutcomeUnknownError`；它与 `ControlResultUnknownError`、`ApiError.outcomeUnknown` 一样表示写操作可能已执行，先读回对账，按业务意图保留原幂等键，不自动生成新键重放。查询与写入均可受配置超时约束。App 数据层 `@tier0/sdk-v2/data` 另有自己的策略：每次调用从开始算最多 25 秒（含排队与重试）、每进程最多 6 个并发请求、写入自动生成幂等键、按 `retry.safe` 最多自动重试 2 次；`runWithRequestContext(request, …)` 传入请求本身时，请求中止后排队中的调用不再发出。

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

上游：`FREEZONEX/Tier0-Backend`。当前固定提交与输入 SHA-256 以 [contracts/upstream.json](contracts/upstream.json) 为准，Cloud 扩展版本见 [UNS 契约来源](contracts/uns-v2/provenance.json)。API 合约已同步不代表目标环境已经部署；使用上述新参数前确认环境版本。

```sh
npm ci
npm run check

# 更新时显式提供后端 checkout 与已提交版本；不会自动读取工作区未提交修改。
npm run sync:contracts -- ../Tier0-Backend <commit>
npm run generate
npm run check
```

平台操作来自固定版本的 `/openapi/v2/swagger.json` 有效契约，生成器据此处理响应外层；UNS 来自 `contract_generated.go#ContractJSON` 中已经应用 Cloud 扩展的契约，结合 manifest/registry 生成。不能直接使用仍含 Enterprise 基础操作的 `share/unscontract/contract.json` 作为最终云端契约。

`npm run check` 包含契约一致性、Skill 注册及递归引用检查、所有 Skill TypeScript 示例的源码/安装包类型校验、单元和本地 HTTP 测试、ESM/CJS 构建、实际 npm 包安装、浏览器打包及导入验证。完整行为测试还会在独立 consumer 中对已安装的 `.tgz` 再跑一遍，导入目标严格指向包内 `dist`；包内调试映射包含源内容。路由检查覆盖生成契约的全部公开操作，使用本地 HTTP fixture，不等于每个操作的业务验收。

`tests/skill-workflows.test.ts` 直接提取 Markdown 示例，验证 Source/Stream/UNS 的创建、查询、修改、删除或归档恢复，影响分页和结果未知分支，以及通知请求、状态查询和成员展示。默认检查不调用线上接口。

真实环境验收脚本使用刚安装的包，先通过 `whoami` 核对 Workspace，再执行选定操作。`TIER0_API_HOST` 必须指向 API 网关（开发环境为 `https://api-dev.tier0.cn`，不是网页域名 `dev.tier0.cn`），`TIER0_API_KEY` 由当前进程环境提供，不放进命令行参数或版本库。

```sh
# consumer 路径使用 npm run check 最后输出的 .tmp/package-check-* 目录。
node scripts/check-live-readonly.mjs <consumer> <workspaceId> .tmp/live-readonly.json

# 仅在已授权的测试 Workspace 执行；会创建、修改、归档/删除本次测试资源。
# 可用 TIER0_TEST_DOMAINS 选择 source,stream,uns,files；追加 extended 扩展 UNS 验收。
node scripts/check-live-workflows.mjs <consumer> <workspaceId> .tmp/live-workflows.json --write-test-fixtures
node scripts/check-live-transports.mjs <consumer> <workspaceId> .tmp/live-transports.json --write-test-fixtures
```

写入验收不发布 Stream、不启用 Source、不发送通知。归档资源保留正常产品恢复能力；报告区分通过、服务端拒绝和未验证范围。分片上传失败会保留错误原因，确认尚未尝试 complete 时清理本次会话；完成结果未知时先对账。完整结果见 [2026-10-22 验收报告](docs/acceptance-2026-10-22.md)。

业务接入时仍需核对验收报告中的环境限制并补齐未验收范围、将 App 脚手架精确依赖更新为 `"@tier0/sdk-v2": "0.3.0"`，并按需更新已安装的 Skill。
