# @tier0/sdk-v2

Tier0 云端统一 TypeScript / JavaScript SDK，数据管理与 App Stream 交互均使用 `@tier0/sdk-v2`。旧 SDK 不再作为依赖。

`0.9.3` 同步集合授权合同：授予既有集合访问权限时无需提供别名，并更新生成类型与使用说明。集合声明的 `name` / `alias` 要求保持不变。

`0.9.2` 包含接口合同变更，升级时需核对下方使用方式并确认目标后端已部署对应合同。平台接口统一使用 OpenAPI v2，能力发现使用 `state + reasonCode + operations`。Stream 请求与消息交互统一到本包的 `client.streams`；`client.stream` 保留 Stream 管理。文件上传支持并发分片与断点续传。

Collection 声明必须同时提供业务名称 `name`（例如「生产工单」）和稳定程序标识 `alias`（例如 `production_orders`），高层声明与底层请求类型一致。`name` 是唯一展示名称，不支持 `displayName`；ensure 仅在创建时写入名称，重复 ensure 保留用户改名，同目录重名明确报错。使用前需确认后端已包含 `business-name/1` 契约。

`0.7.x` 已移除旧 Controls 入口、生成操作、DTO 和错误类，不保留别名。能力发现不再以可选交互合同阻断 Namespace，未知核心合同仍严格拒绝。V2 的 `execution` / `retry` 和结果未知语义保持不变。

`0.6.0` 的 HTTP Source 只保留 `protocol: http-api`，通过 `config.role: client | server` 区分主动请求与入站服务。旧 `http` / `http_push` 配置需要迁移；响应时机属于 Stream，不再建立独立异步 Source。同步 singlemodel 合同后，Source 配置不再带 configVersion，Stream 输入不再带 sdkVersion；保留完整 module.exports 程序与原生 script 对象/Runtime program 字符串两种既有形态，不能将旧 transform 函数体直接改名迁入。

`0.4.0` 版本变更：相对 0.3.x 移除已退役的 Stream 就绪探针且不保留别名，改用服务端现有统一权限，不再配置逐 Key Control scopes/codes。0.3.0 起统一使用 OpenAPI v2 并退役重复及旧接口；与 0.2.x 存在不兼容变更，迁移方式见下方“本次接口退役”。对应 UNS v2 契约 5.0.0，与 0.1.0 不兼容（新错误模型 `execution` / `retry`、封顶计数、删除 `recordChangesPoll` 等）。Collection 支持 int、float、double 和 datetime 声明；格式注解不新增数值范围或日期格式校验，Sample 外层 time 保持不变。使用时需确认目标环境已部署对应后端。要求 Node.js 20.19+。浏览器 HTTP、MQTT、React、Vue 和服务端身份验签分别提供独立入口。

合同快照的准确 Backend 提交和输入摘要见 contracts/upstream.json；使用前需确认目标环境已部署相应合同。请求统一权限、旧探针退役门禁、Source discovery 的副作用分类及不自动重试语义保持不变。

既有接口收敛：平台接口统一迁移到 `/openapi/v2`；移除 21 个重复 UNS 入口和旧 Agent nodes/relations 方法。完善 Source 操作、Stream 发布回执及 UNS 创建快照的使用说明，保留精确发布编号和完整文档访问规则。

## 安装与初始化

维护者发布前在本仓库运行 `npm ci`、`npm run check`，并验证生成的 `.tgz`。本分支的功能应使用检查通过的 `tier0-sdk-v2-0.9.3.tgz` 在业务项目中验证：

```sh
npm install /path/to/tier0-sdk-v2-0.9.3.tgz
```

`0.9.3` 正式发布后再使用 `npm install @tier0/sdk-v2@0.9.3`。发布前，npm 的既有版本和 `next` 标签不代表本分支的完整功能。

```ts
import { createClient } from '@tier0/sdk-v2';

// 服务端环境注入 TIER0_API_HOST 和 TIER0_API_KEY。
const tier0 = createClient();
// 首次接入时确认身份与 Workspace；不需要在每次业务操作前重复调用。
const user = await tier0.system.whoami();
```

也可显式配置 `{ apiHost, apiKey, transportTimeoutMs, fetch }`，或提供 `getApiHost` / `getApiKey` 回调。裸域名默认使用 HTTPS；本地 HTTP 测试请显式写 `http://127.0.0.1:端口`。不自动向浏览器注入或读取 `VITE_` API Key。

`createClient()` 实例之间不共享配置；推荐在一个稳定身份的服务生命周期内复用实例。员工数据委托必须为每个请求创建新实例，传入受信网关的 `unsV2AppDataSubject`。App Key 只代表 App，不能替代当前用户身份，也不能下发到浏览器。浏览器页面应调用自己的服务端 API。

## 能力与入口

| 入口 | 能力 |
| --- | --- |
| `tier0.source` | 数据源、连接文档、影响分析、版本历史与运行观测 |
| `tier0.stream` | Runtime programs、原生文档、校验、部署、回滚与运行记录 |
| `tier0.streams` | App 请求、实时业务消息与独立交互能力发现 |
| `tier0.uns` | 目录、Topic、Collection、Record、Sample、事务与 App 数据上下文 |
| `tier0.system` | `whoami()`、`info()` |
| `tier0.members` | `listWorkspace()` 用于 Workspace 级成员选择；`listApp({ appId })` 查询能使用指定 App 的成员 |
| `tier0.notifications` | `send()`、`get()` |
| `tier0.files` | `upload()`、`uploadMultipart()`、`resumeMultipart()`、`url()`、`download()`、`delete()`、`multipart` 原子接口 |
| `tier0.mqttAuth` | 创建、删除 MQTT 凭证 |
| `tier0.agent` | `analyses`、`canvases`、`cards`、`jobs`、`jobRuns`、`library`、`results` |
| `tier0.capabilities` | 当前凭证可见的能力发现；就绪状态由服务端判断 |
| `tier0.api` | 44 个平台 OpenAPI v2 的完整生成接口；通常优先使用上面的领域入口 |
| `@tier0/sdk-v2/mq` | MQTT WebSocket 客户端与 broker 地址工具；不进入根入口依赖图 |
| `@tier0/sdk-v2/source` | `createSourceClient()`，独立 Source 客户端 |
| `@tier0/sdk-v2/stream` | `createStreamClient()`，独立 Stream 客户端 |
| `@tier0/sdk-v2/streams` | Stream 交互客户端、错误类与消息类型 |
| `@tier0/sdk-v2/runtime` | 受信 App 宿主 provider 安装与生命周期；业务页面无需调用 |
| `@tier0/sdk-v2/react` | `useTier0Query()`、`useTier0Mutation()`，需要 React 和 TanStack Query |
| `@tier0/sdk-v2/vue` | `useTier0Request()`，需要 Vue 3 |
| `@tier0/sdk-v2/server` | `createCloudAppRequestVerifier()`，仅服务端加载 `node:crypto` |
| `@tier0/sdk-v2/data` | App 数据层：`defineCollection()` 声明集合（含 TTL）、`createDataClient()` 首次访问时 ensure，Mongo 风格读写、带总数分页与封顶计数、原子批量与 `transact`、`subscribe` 变更订阅、员工数据主体透传；自动幂等键、并发上限与按 `retry.safe` 重试；仅服务端，需要 `zod` 4 |
| `@tier0/sdk-v2/data/define` | 集合声明与类型：`defineCollection()`、`Doc` / `NewDoc` 等、`compileCollection()`、`validateDocument()`；可进浏览器包，组件和 route 的客户端代码只从这里取声明和类型 |

集合声明必须分别提供稳定程序标识 `alias` 和业务名称 `name`，例如 `alias: 'production_orders'`、`name: '生产工单'`。目录、数据和引用直接用 name 展示，不提供 displayName 或名称回退；name 为 1–63 个 Unicode 字符，无首尾空白，不含 `/` 或空字符。ensure 按 alias 关联集合，仅首次创建设置 name，不覆盖用户改名。名称冲突时选择有区分度的业务名称，不拼随机后缀。

不保留 UNS v1、旧 Flow、`getCurrentProjectId()`、project 成员查询或 `/gw/reload`。Workspace 成员不等于能使用某个 App 的成员，不可用前者在客户端猜测 App 权限。

## 本次接口退役

HTTP 调用统一使用 `/openapi/v2`。21 个重复 UNS 公共入口及生成方法直接移除，没有旧路由回退；升级 SDK 时需同时部署对应后端。

- Source 的 list/get/create/update、connection.update 改用 documents.*；Stream 的 programs.get/create/update/validate/disable 改用 documents.*，停用同时携带 expectedRevision 与 expectedActiveRelease。
- 低层 findOneAnd* 改用 updateOne/replaceOne/deleteOne 的 returnDocument；批量新增用 bulkWrite 的 insertOne 项；元数据单条读取用 metadataFind + limit:1，去重用 aggregate。
- App 数据层的 insertMany、findOneAnd*、distinct 等便捷方法保留，由 SDK 映射到当前入口；insertMany 仍是单次原子请求，最多 200 项。
- Agent 的旧 nodes.searchSemantic/indexSync 和 relations.list/teach 没有 v2 契约，不再导出。旧 Controls 便捷入口、操作、DTO 和错误类不再导出，也没有兼容别名。

升级前应核对旧写请求的最终结果，包括集合初始化 seed。退役入口不再可调用，不能将未知结果的旧请求或幂等键直接改投新入口重做。当前入口的重试仍保留原路径、原键和原载荷。

`client.capabilities.discover()` 使用 `POST /openapi/v2/capabilities/discover` 和空对象，返回直接 JSON。能力发现使用合同 2.0，以 state、reasonCode 和 operations 表达结果，不再返回 enabled、allowed、releaseEnabled、availability；服务端必须同步部署该合同，只消费 Namespace、Source、Stream 管理能力，不以 App 交互域的版本标签作为前置条件。Source / Stream 的 `operations` 分别描述读取、配置、运行等操作，保留 `reasonCode`、`checkedAt`、`validUntil` 和 `requiresResourceCheck`；领域整体不可用时，读取或安全停用仍可能可用。证明到期后重新发现，实际操作仍需服务端检查具体资源权限和依赖。发现不代表设备在线或操作已成功，不自动重试。

## Source、Stream 与 UNS 分域

Source 负责连接外部系统，Stream 负责处理与运行，UNS 负责命名空间与业务数据。公开操作由固定的上游契约生成，业务入口按领域组织。Stream 请求与消息交互使用本包 `client.streams.requests` / `client.streams.messages`，App 只安装一个 SDK。目录、Topic、集合基础 CRUD 统一使用 `metadata*`，查询、批量操作、软删除及恢复见 UNS Skill。

```ts
const sources = await tier0.source.documents.list({ page: 1, size: 20 });
const programs = await tier0.stream.programs.list({ page: 1, size: 20 });
```

HTTP Source 统一使用 `protocol: 'http-api'`，显式设置 `config.role: 'client'`（主动请求）或 `config.role: 'server'`（接收入站请求），与 Enterprise 一协议两角色保持一致；Cloud 管理文档的角色位于 config 内。Server 不能作为 Client 发起主动请求。HTTPServer 使用固定前缀 `/ingest/v1/{workspaceId}/{sourceId}`，业务路由注册在 Stream；普通返回在处理和提交完成后回复；HTTP `onRequest` 可通过一次 `await ctx.reply(...)` 先回复再继续，仍受超时、并发和权限限制，回复后不随客户端断线取消但可由 shutdown 取消，不保证崩溃重放。202 状态本身不证明处理完成。示例见 [HTTPServer Stream Skill](skills/tier0-sdk-v2/tier0-sdk-v2-stream/references/http-server.md)。使用 `source.protocols.list({})` 核对目标环境支持，再通过现有 `source.documents.*` 管理配置。HTTP Client 单条 inline 创建支持 Basic、Bearer、APIKey、OAuth 四类认证；普通创建省略 credentials.method，由服务端默认 REQUEST 基址绑定，真实 method/path/query 在 Stream 定义。Basic/Bearer 显式凭据方法同时限制精确 URL，OAuth 旧 GET 保留既有兼容语义，存量限制不自动扩大；独立 credentialCreate 仍为 coreOnly。SDK 不新增猜测的 HTTP In API；npm 管理 SDK 与执行器中的 Goja Stream 脚本 API 分开使用。

Source/Stream 仍保留 `{ code, msg, requestId, data }` 响应以及 `UnsV2Error` 错误类型。Source 配置统一使用 `source.documents`；Stream 草稿统一通过 `stream.documents` 创建、读取、校验和修改，输入 `program` 与 `document` 二选一。发布和回滚仍走 `stream.programs`。保存、部署、运行成功分别判断。

- 已知 Source ID/revision 且没有 Stream 引用时，可 [直接 patch 或变更状态](skills/tier0-sdk-v2/tier0-sdk-v2-source/references/update.md)；有引用时仍按精确意图确认影响。
- Stream 发布和回滚可携带并发守卫：有生效发布时使用 `expectedActiveRelease`，无生效发布时使用 `expectedReleaseState: 'inactive'`。[发布回执](skills/tier0-sdk-v2/tier0-sdk-v2-stream/references/deploy.md) 的 activeRelease 也可用于观察这次发布。
- 单条 Record 新增可用 [returnDocument:'after'](skills/tier0-sdk-v2/tier0-sdk-v2-uns/references/create.md) 同次取得创建快照；[App 数据层](skills/tier0-sdk-v2/tier0-sdk-v2-data/references/read-write.md) 支持相同选择及投影类型。

从最初提交迁移：`uns.sourceList` → `source.documents.list`；`uns.sourceDocumentGet` → `source.documents.get`；`uns.streamProgramDeploy` → `stream.programs.deploy`；`uns.streamDocumentValidate` → `stream.documents.validate`。这些管理方法已移出主入口的 `uns`。底层 `createUnsV2Client()` 仍提供完整生成契约供契约工具使用；数据专用客户端可用 `createUnsDataClient()`。

随包提供 Skill：总入口 [tier0-sdk-v2](skills/tier0-sdk-v2/SKILL.md) 下嵌套 11 个领域子 Skill（`skills/tier0-sdk-v2/tier0-sdk-v2-<领域>/`），每个仍可独立发现，包含完整流程、参数边界、错误处理与可类型检查的示例：[Source](skills/tier0-sdk-v2/tier0-sdk-v2-source/SKILL.md)、[Stream](skills/tier0-sdk-v2/tier0-sdk-v2-stream/SKILL.md)、[UNS](skills/tier0-sdk-v2/tier0-sdk-v2-uns/SKILL.md)、[通知](skills/tier0-sdk-v2/tier0-sdk-v2-notifications/SKILL.md)、[系统](skills/tier0-sdk-v2/tier0-sdk-v2-system/SKILL.md)、[文件](skills/tier0-sdk-v2/tier0-sdk-v2-files/SKILL.md)、[MQTT](skills/tier0-sdk-v2/tier0-sdk-v2-mq/SKILL.md)、[成员](skills/tier0-sdk-v2/tier0-sdk-v2-members/SKILL.md)、[Agent](skills/tier0-sdk-v2/tier0-sdk-v2-agent/SKILL.md)、[App 数据](skills/tier0-sdk-v2/tier0-sdk-v2-data/SKILL.md)、[App Stream 交互](skills/tier0-sdk-v2/tier0-sdk-v2-streams/SKILL.md)。复杂流程的参考文档随 Skill 一起打包。在 Tier0 Console 上传时，把整个 `skills/tier0-sdk-v2/` 目录打成一个 zip。

## UNS 数据访问

创建本 App 集合使用 `defineCollection` / `appCollectionsEnsure`，`ownerAppId` 表示唯一所属 App。使用已有或其他 App 共享的集合，直接向 `tier0.uns.recordFind`、`recordInsertOne` 等现有接口传入实际 `collectionId`；无需新增声明或配置服务端 alias，也不改变集合归属。App Key 仍须已有覆盖该集合及操作的授权，知道 ID 不代表获得权限。

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

`client.capabilities` 只校验 Namespace/Source/Stream 管理合同，不要求全局交互标签；同包 `client.streams.capabilities` 独立校验 App 请求合同，不阻断 Namespace。各自消费的核心合同未知仍拒绝，不将方法存在当作授权或运行就绪。

实际集合 ID 和有效权限从平台配置/数据上下文取得。管理操作中，App 凭证只能调用本 App 集合的 `appCollectionsEnsure` / `appCollectionsSchemaReplace` / `appCollectionsArchive` / `appCollectionsRestore`；SDK 中存在 `metadataInsertOne` 等其他管理方法，不表示 App 凭证有对应权限。App 数据授权 `appDataPolicyGet` / `appDataPolicyUpdate` 的调用方必须是：持有 `uns.write` 的登录会话、持有 `uns.write` 且 full_access、不绑定 App 的 personal / agent Key，或治理会话；运行时 App 凭证不能管理授权。Core-only 后台接口不导出到公开 SDK。

UNS 保留 `{ code, msg, requestId, data }` 完整响应。平台 v2 包装接口返回已解包的 `data`，通知/能力发现返回直接对象。业务错误即使 HTTP 为 200 也会抛出 `ApiError`。

`int64` 和平台整数字段使用 `number | bigint`：安全范围内返回 number，超出范围返回 bigint。UNS 任意 JSON 中无法无损表示的数字用 `UnsV2RawNumber`；传回 SDK 可保持原值。对外输出 JSON 时自行确定 bigint/精确数字的表示，不要直接 `JSON.stringify` 包含这些值的对象。

`createClient()` 的 HTTP 操作不自动重试。UNS v2 错误带 `execution`（`notStarted` / `rolledBack` / `committed` / `unknown`）与 `retry: { safe, afterMs? }`：`safe` 表示可以用同一请求（同一幂等键）重发。`execution` 为 `unknown` 时抛出 `UnsV2OutcomeUnknownError`；它与 `ApiError.outcomeUnknown` 一样表示写操作可能已执行，先读回对账，按业务意图保留原幂等键，不自动生成新键重放。查询与写入均可受配置超时约束。App 数据层 `@tier0/sdk-v2/data` 另有自己的策略：每次调用从开始算最多 25 秒（含排队与重试）、每进程最多 6 个并发请求、写入自动生成幂等键、按 `retry.safe` 最多自动重试 2 次；`runWithRequestContext(request, …)` 传入请求本身时，请求中止后排队中的调用不再发出。

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
const response = await tier0.files.download({ filePath: stableReference });
const bytes = await response.arrayBuffer();
```

只需要临时链接时调用 `files.url({ filePath })`；`download()` 已包含获取链接，无需先调用 url。

保存 `filePath`，不把临时签名地址当作持久化引用。上传由平台签发地址后直传对象存储，平台 API Key 不传到存储域名；下载先获取签名地址，再匿名获取文件，避免认证重定向泄漏凭证。

超过 100 MiB 自动使用分片上传，也可用 `upload(file, { multipart: {} })` 或 `uploadMultipart(file, options)` 对小文件显式分片。分片默认并发 4；仅同一地址、同一内容的 PUT 瞬时失败安全重试，init/complete 不自动重放。中断后 `MultipartUploadError.session` 保留文件身份、切片参数和成功分片，可用 `resumeMultipart(file, session, options)` 续传。进度包含字节、分片数和百分比；尝试过 complete 后必须先核对结果，不能直接续传。

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

写入验收不发布 Stream、不启用 Source、不发送通知。归档资源保留正常产品恢复能力；报告区分通过、服务端拒绝和未验证范围。分片上传失败会保留错误原因，确认尚未尝试 complete 时清理本次会话；完成结果未知时先对账。

Stream 发布和实际运行使用单独的验收脚本，同样只在明确授权的测试 Workspace 执行；按脚本报告区分已测和未测的生命周期阶段：

```sh
node scripts/check-live-stream-runtime.mjs <consumer> <workspaceId> .tmp/live-stream-runtime.json --write-test-fixtures
```

业务项目锁定实际安装的版本并同步更新随包 Skills；本地检查不代表线上业务验收通过。

平台接口与能力发现的本地联调可分别运行 `node scripts/sync-contracts.mjs <backend> --worktree --platform-only` 和 `node scripts/sync-capability-contract.mjs <backend> --worktree`。预览来源明确记录基线和内容摘要，不能直接发布。Backend 提交后，将两条命令的 `--worktree` 替换为正式提交 SHA，再运行 `npm run generate && npm run check`；UNS 数据模型仍使用其独立固定输入。

采集流程的 Source 创建/更新/状态变更、Stream 文档创建/更新/部署均可省略 `dryRun`（默认 false 提交）。SQL 新连接可在 `source.documents.create` 中直接传 `credentials.kind: usernamePassword` 与只写用户名/密码，不传 `credentials.method`；连接地址不携带秘密。`contracts/uns-v2/provenance.json` 的 `schemaUpdates` 记录这次有限合同更新，共享数据模型继续使用固定基础版本。

## App Stream 交互与旧包迁移

浏览器使用 `import { client } from "@tier0/sdk-v2"`，调用 `client.streams.requests.use({code}).invoke(input, {idempotencyKey})` 或 `client.streams.messages.use({topic}).subscribe(handler)`；受信宿主自动提供连接，浏览器不配置 API Key。服务端使用根入口 `createClient()`，沿用环境注入。订阅不再使用时 dispose，客户端退出时 `await client.dispose()`；请求与消息不会自动重放业务写入。

旧 `/cloud` 改用根入口，`/cloud/server` 改用 `/server`，`/openapi/react` 和 `/openapi/vue` 改用 `/react` 和 `/vue`。`/streams`、`/runtime` 的现役能力已原生迁入本包；宿主 runtime Symbol 保留原协议标识，避免破坏已有网关注入。Source/Stream 管理、文件、MQTT、通知、成员和集合继续使用本包现有入口；旧文件单例函数改为 `client.files` 对应方法。旧 `getCurrentProjectId`、Flow、Control 及项目接口已退役，不迁回。

| 旧包现役能力 | 统一后的入口与迁移方式 |
| --- | --- |
| 根入口、`/cloud` 的 `client` / `createClient` | `@tier0/sdk-v2` 根入口；同一实例提供数据管理和 App 交互 |
| Stream `describe` / `discover` / `invoke` | `client.streams.requests`；保留类型、幂等键和结果未知语义 |
| 消息 `publish` / `subscribe` / `onError` / `dispose` | `client.streams.messages`；原生 NATS WSS，消息需要浏览器 WebSocket 或 Node.js 22+；HTTP 仍支持 Node.js 20.19+ |
| 请求/invoke 能力发现 | `client.streams.capabilities.discover()`；`client.capabilities.discover()` 独立保留 Namespace/Source/Stream 作用域 |
| Trusted runtime provider / App 请求验签 | `/runtime` / `/server`；原有宿主 Symbol 协议保持不变 |
| `unsV2`、平台操作、MQTT | `client.uns` / `client.source` / `client.stream`、现有平台入口、`/mq`；旧包全部现役公开操作已有对应 v2 操作 |
| `uploadFile` / `uploadFileMultipart` / `resumeMultipartUpload` | `client.files.upload` / `uploadMultipart` / `resumeMultipart`；上传选项与返回类型从 `/files` 导入 |
| `getFileUrl` / `downloadFile` / `deleteFile` | `client.files.url` / `download` / `delete`；download 返回原生 `Response` |
| 旧 React / Vue 每接口 hook | `/react` 的通用 query/mutation、`/vue` 的 `useTier0Request`；使用统一 client 和对应方法 |
| Project、Control、Flow 及旧配置版本入口 | 已退役，不提供别名或重新导出 |

真实消息本地验收用 `npm run test:streams:artifact`（Go、Node.js 22+、`nats-server`，通过 `TIER0_STREAM_MESSAGES_BACKEND_DIR` 指向 Backend checkout）。脚本验证生产 Go issuer、TLS NATS、已安装 tarball 的 ESM/CJS 及浏览器依赖闭包；固定夹具身份不代表线上 SYS/Gateway/App 权限链路或浏览器端到端验收。

代码存在不代表已发布。先构建并安装这次统一实现的不可变制品，更新 App 模板、依赖锁与存量 App，再移除旧包；不能用旧 npm 0.7.2 替代本分支构建。完整交互说明见 [Stream 交互](skills/tier0-sdk-v2/tier0-sdk-v2-streams/SKILL.md)。
