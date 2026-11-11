# @tier0/sdk-v2

Tier0 TypeScript / JavaScript SDK，提供资源管理、业务数据与 App Stream 交互。Node.js 20.19+；Stream 消息需要 Node.js 22+。

Source 保存连接与认证，Stream 执行采集或业务逻辑，Collection 保存业务记录。按任务选择入口，不要求读取数据前先创建整条流水线：

| 任务 | 入口 | 文档 |
| --- | --- | --- |
| 接入外部系统、配置认证与检查连接 | `client.source` | [Source](skills/tier0-sdk-v2/tier0-sdk-v2-source/SKILL.md) |
| 保存、发布和诊断处理程序 | `client.stream` | [Stream](skills/tier0-sdk-v2/tier0-sdk-v2-stream/SKILL.md) |
| 调用请求、订阅或发布业务消息 | `client.streams` | [Stream 交互](skills/tier0-sdk-v2/tier0-sdk-v2-streams/SKILL.md) |
| 集合结构、记录、历史采样与授权 | `client.uns` | [Collection / UNS](skills/tier0-sdk-v2/tier0-sdk-v2-uns/SKILL.md) |
| App 集合声明与 Mongo 风格数据访问 | `@tier0/sdk-v2/data` | [App 数据](skills/tier0-sdk-v2/tier0-sdk-v2-data/SKILL.md) |

其余入口见[能力与入口](#能力与入口)，Agent 按 [Skill 总入口](skills/tier0-sdk-v2/SKILL.md) 选择对应参考。版本变更与升级记录见 [CHANGELOG](CHANGELOG.md)；生成契约来源见 [contracts/upstream.json](contracts/upstream.json)。方法存在不代表目标环境已部署或当前凭证可调用。

## 安装与初始化

安装正式版：

```sh
npm install @tier0/sdk-v2@0.11.0
```

维护者发布前在本仓库运行 `npm ci`、`npm run check`，并验证生成的 `tier0-sdk-v2-0.11.0.tgz`。

个人 Key 可直接读取已有集合，无需创建平台 App；网关配置、运行示例与排错见[本地连接指南](skills/tier0-sdk-v2/references/local-connection.md)。

```ts
import { createClient } from '@tier0/sdk-v2';

// 服务端读取 TIER0_API_HOST / TIER0_API_KEY；平台 App 运行时由平台注入。
const tier0 = createClient();
```

也可显式配置 `{ apiHost, apiKey, transportTimeoutMs, fetch }`，或提供 `getApiHost` / `getApiKey` 回调。裸域名默认使用 HTTPS；本地 HTTP 测试请显式写 `http://127.0.0.1:端口`。不自动向浏览器注入或读取 `VITE_` API Key。

底层 HTTP 凭证来源按配置属性是否存在固定：`apiKeyProvider` 优先于 `apiKey`，再优先于 `getApiKey`；只有三者均未提供时才读取 `TIER0_API_KEY`。显式传入 `undefined`、空 Key，或同步 getter 返回 `undefined` 时不会回退到其他 Key，底层请求不带认证头；异步 provider 返回无效值会在发送前失败。Data 客户端对动态来源及缺失 Key 的处理见下文。此前依赖这些空值回退环境 Key 的调用方，需要去掉对应属性，或显式提供所需 Key。每个用户或请求应创建自己的客户端，不能用全局 `configureClient` 保存每请求身份。

SDK 访问平台 API 时仅发送 `X-API-Key`，不同时发送 `Authorization`；Cloud Gateway 的 enforce 模式会拒绝多来源凭据。`whoami` 同样使用单个 `X-API-Key`。API Key 应留在服务端，浏览器通过应用服务端调用平台 API；网关默认 CORS 配置可能不允许跨源 `X-API-Key`。

服务端底层 HTTP 客户端也可配置 `apiKeyProvider: async ({ signal }) => ...`，每次 HTTP 请求或 SSE 连接分别解析一次 API Key。provider 必须返回非空的可打印 ASCII 字符串；失败、取消或超时会终止该次请求，不回退到静态 Key 或环境变量。provider 应使用 `signal` 停止自己的异步工作。SDK 不缓存 provider 返回的 Key，也不会因此重放请求；调用者须确保重试期间身份和幂等作用域一致。`@tier0/sdk-v2/data` 的 `createDataClient` 不支持 `apiKeyProvider` 或 `getApiKey`，会直接拒绝；它在创建时固定静态 Key 和 Host，包括从环境变量取得的值。需要更换身份或环境配置时须新建 Data 客户端，不能复用原有 bootstrap、重试和订阅状态。该接口只提供现有 API Key 的动态获取。

服务端已有经授权的主体 Key 时，可以为每个可信主体创建独立 Data 客户端，并按实际权限访问已有集合：

```ts
import { createDataClient } from '@tier0/sdk-v2/data';

export function dataForPrincipal(apiHost: string, apiKey: string) {
  if (!apiHost.trim() || !apiKey.trim()) throw new Error('A host and principal key are required');
  return createDataClient({ apiHost, apiKey });
}

// 从可信服务端身份链取得该主体已获授权的 Key 和集合 ID 后：
// const count = await dataForPrincipal(apiHost, apiKey).collection({ collectionId }).countDocuments();
```

不要从客户端自报的主体推导 Key，也不要跨主体复用客户端；Key 轮换后创建新实例。声明集合的 ensure/seed 是否允许由服务端凭证和权限决定，此例不声明集合。App 共用固定 App Key 时，平台不按访问者收窄数据；按用户角色决定谁能看什么是 App 自己的事（见「aenv-next 运行环境」的访问者头）。

Data 高层会跨请求复用 ensure 结果、重放带幂等键的 seed、恢复 stale 集合和续接 SSE。现有 whoami 不返回权威 App ID，同一工作空间和创建者的不同 App Key 可能具有相同的 workspace/user/type；名称、前缀或 provider 自报的身份不能证明不同 Key 属于同一主体。移除高层拒绝前，需要与实际请求凭据绑定、可验证且覆盖 App 及幂等作用域的服务端身份合同，并将这些跨请求状态隔离到已确认主体。`scripts/check-data-principal-boundary.mjs` 可在受控环境中用真实 Gateway 和两个不同 App 的临时 Key 验证此边界；脚本开头列出输入，Key 文件由调用方在验证后撤销和清理。

`createClient()` 实例之间不共享配置；推荐在一个稳定身份的服务生命周期内复用实例。App Key 只代表 App，不能替代当前用户身份，也不能下发到浏览器。浏览器页面应调用自己的服务端 API。

## aenv-next 运行环境

**平台把 App 的 Key 放在运行进程的环境里，SDK 直接用它。** Tier0 预览和部署里，平台给 App 的运行进程注入 `TIER0_API_KEY`（这个 App 的 Key，秘密；预览是 App 的 preview Key，部署是 deployed Key，平台据此把预览里发的通知判为 test）。它只在运行进程的环境里，不进构建、不写文件。SDK 照常读 `TIER0_API_HOST` / `TIER0_API_KEY`，每个请求只发一个 `X-API-Key`。App 代码不要自己读、复制、打印或下发这个 Key，也不要把它放进 `.env`、集合或页面。所有平台调用都是 App 自身，请求里不带访问者身份。

平台设置的环境变量：

| 变量 | 值 |
| --- | --- |
| `TIER0_API_HOST` | 平台 API 网关根地址，带 scheme。不带 scheme 的主机名按 `https://` 处理 |
| `TIER0_API_KEY` | App 的 Key（秘密，只在运行进程里） |
| `TIER0_MQTT_HOST`、`TIER0_MQTT_PORT` | App 服务端能连到的 MQTT broker 入口 |
| `TIER0_WORKSPACE_ID` | 工作区 ID |
| `TIER0_APP_ID` | App ID（`getCurrentAppId()` 先读它，再读旧的 `APP_ID`） |
| `TIER0_RUNTIME` | `deployed` 或 `preview`；只由平台设置，本地开发不要设（它还决定 `members.listApp()` 的口径和平台代理模式） |

App 的 Key（平台注入的这把）只能调 `/openapi/v2/uns/**`、`assets/files/**`（`client.files`；同在 `assets/` 下的 `assets/upload` 不在内，回 403）、`notifications/send`、`platform/getMembers`（`members.listWorkspace()`）、`apps/access-members/list`（`members.listApp()`）、`stream-requests/discover` 和 `stream-requests/<code>/describe|invoke`（`client.streams.requests`）、`stream-messages/connect`（`client.streams.messages`）、`capabilities/discover`、`info`，Backend 在每个入口都这样限制，其他接口（`system.whoami()`、`notifications.get`、`mqttAuth`、`agent`）回 403 `hosted_app_key_route_forbidden`；在 App 设置里另签给外部系统用的 App Key 不受这张表限制。App 的平台能力固定 11 项，每个 App 都有，不在 App 设置里配置：`openapi.base`、`platform.users.read`、`notifications.send`、`asset.file.upload` / `download` / `delete`、`stream.requests.read` / `invoke` / `write`、`stream.messages.publish` / `subscribe`。实际生效的是它们和 Key 自身权限、Key 模式、工作区套餐的交集（`uns.dataAppContext({})` 返回的 `platformPermissions`），例如套餐不含 Stream 时 Stream 请求和消息仍被拒绝。数据只能访问 App 自己建的集合及已获授权的已有集合；内置 Builder 以自身系统身份主动关联已有集合，不查询对话用户的角色或要求其确认，App 运行时凭证不能自行扩大授权；授权删掉后下一个请求起生效，`records:subscribe` 在下一轮长轮询（最多约 15 秒）收到 `SCOPE_CHANGED`。MQTT 只能用 App 自己的命名空间，见 [MQTT](#mqtt)。

**平台代理模式**（保留给不带 Key 的运行时）：`TIER0_RUNTIME` 为 `deployed` 或 `preview`、而进程里没有 `TIER0_API_KEY` 时，SDK 不读也不发任何凭据，每个请求带 `X-Tier0-SDK: 1`，只对节点代理自己产生的 `503`、`429`（带 `X-Tier0-Proxy: not-forwarded`，`code` 以 `sbx_proxy_` 开头）按 `retry_after_ms` 最多重试 3 次；MQTT 用 `TIER0_MQTT_URL`（`mqtt://`）且不发 password。传了有值的 `apiKey`，或给了 `getApiKey` / `apiKeyProvider` 的客户端始终按显式配置。没有 `TIER0_API_KEY` 而 `TIER0_RUNTIME` 是其他非空值时，SDK 抛出配置错误，不猜测模式。当前平台给绑定 App 的会话和已发布的 App 都注入 `TIER0_API_KEY`，不会进入这个模式；没绑 App 的会话没有 Key 也没有 `TIER0_API_HOST`，调平台会报 `DATA_NOT_CONFIGURED` 一类的配置错误。

本地开发照旧设 `TIER0_API_HOST`、`TIER0_API_KEY`，不要设 `TIER0_RUNTIME`（也不要写进 `.env` 或 `artifact.toml`）。

- `@tier0/sdk-v2/server`：`parseVisitorHeader(request.headers.get(VISITOR_HEADER))` 解析前门注入的 `X-Tier0-Visitor`，返回 `{ subType, subject, grant, workspaceID, appID, runtime, appRoles, activeRole? }`。头的值是 UTF-8 JSON 对象的无填充 base64url（编码前最多 8192 字节），不签名：前门转发前剥掉客户端带来的全部 `X-Tier0-*`，再注入这一个头。解析是严格的：只接受规范的无填充 base64url；BOM、重复键、孤立的 UTF-16 代理项（如 `"\ud800"`）、未知字段、缺必填字段、类型或长度不符、`ws` 不是正整数十进制串（不带符号和前导 0）、非 employee 访问者、空 grant、`app` 不等于 `TIER0_APP_ID` 都抛 `VisitorError`（`VISITOR_HEADER_INVALID`）；没有 `TIER0_APP_ID` 时是 `VISITOR_CONFIGURATION_INVALID`。App 用 `appRoles` 自己决定当前用户能看、能改哪些数据；平台对 App 的调用不带访问者身份，不会替 App 收窄。

  ```ts
  import { parseVisitorHeader, VISITOR_HEADER, VisitorError } from '@tier0/sdk-v2/server';

  function visitorOf(request: Request) {
    try {
      return parseVisitorHeader(request.headers.get(VISITOR_HEADER));
    } catch (error) {
      if (error instanceof VisitorError && error.code === 'VISITOR_HEADER_INVALID') return null; // 401
      throw error; // 配置错误：503
    }
  }
  ```

  | 字段 | 头里的字段 | 说明 |
  | --- | --- | --- |
  | `workspaceID` | `ws` | 工作区 ID（十进制数字串） |
  | `appID` | `app` | 等于 `TIER0_APP_ID` |
  | `runtime` | `runtime` | `deployed` 或 `preview` |
  | `subType` | `sub_type` | 仅 `employee` |
  | `subject` | `sub` | 员工用户 ID（1–128 字节） |
  | `grant` | `grant` | 员工访问的 grant ID（1–128 字节，必填） |
  | `appRoles` | `app_roles` | 访问者在 App 里的角色（不限项数，每项 1–128 字节，整个 JSON 不超过 8192 字节；重复的去掉）；预览里是「以某角色查看」选中的角色 |
  | `activeRole` | `active_role` | 可省略，只在预览的「以某角色查看」里出现 |
- `@tier0/sdk-v2/page-runtime`：页面运行时 v1 和平台错误（`x-sbx-error`）。
- `@tier0/sdk-v2/event-stream`：基于 fetch 的 SSE。App 休眠时停止，`resumed` 后重建，节点 agent 重启时透明重连。页面隐藏时关掉连接（后台标签页不占着到 App 的长连接），可见时带最后的事件 id（`Last-Event-ID`）立即续传，服务端补发或回 `reset`；`pauseWhenHidden: false` 关闭这一行为。`EventSource` 遇到 503 不重试，手写时要订阅 `resumed` 后重建。

**MQTT**：只在 App 服务端连接。平台里 `new Tier0MQClient()` 什么都不传：broker 取自 `TIER0_MQTT_HOST` / `TIER0_MQTT_PORT`，password 用 `TIER0_API_KEY`，username 为 `<ws>&open`（ws 从 Key 解析）。App 运行时（有 `TIER0_APP_ID`，Key 来自注入的 `TIER0_API_KEY`，没显式传 `clientId` / `username` / `password`）的 clientId 是托管格式 `<ws>&h.<app>.<16 位随机>`（app 即 `TIER0_APP_ID`），Backend 只接受这种 clientId 的托管 App Key；其他情况保持 `<ws>&<8 位随机>`，显式传的 `clientId` / `username` 优先。页面不直连 broker：浏览器要的实时消息由 App 服务端订阅，按访问者角色过滤后经 App 自己的接口（例如一个 SSE 路由）推给浏览器。`clean` 默认 `false`；服务端按指数退避一直重连，上限 5 分钟。持久会话、QoS 1 下重连不丢消息，但断开期间的积压超过 EMQX 离线队列（默认 `max_mqueue_len=1000`）仍会丢。

**记录变更推给浏览器**：`createChangeRelay(data)` 在每个服务端进程里只开一个 `data.subscribe`（App 身份，看得到 App 被授权集合的全部变更），转发给每个浏览器的 SSE 连接；`filter` 由 App 按访问者决定这个浏览器能知道哪些变更。浏览器不各开上游：Gateway 按工作区限制同时打开的订阅数。

```ts
import { createChangeRelay } from '@tier0/sdk-v2/data';
import type { Visitor } from '@tier0/sdk-v2/server';

const relay = createChangeRelay(data); // 每进程一个

// GET /api/changes，先按访问者头认证：
export function changes(request: Request, visitor: Visitor): Response {
  return relay.stream({
    filter: (change) => canRead(visitor.appRoles, change.collection),
    lastEventId: request.headers.get('Last-Event-ID'),
    signal: request.signal,
  });
}
```

帧：`event: change`（`{ eventId, collection, change, recordId, revision, occurredAt }`，不带记录数据）、`event: reset`（`{ reason }`：可能漏了变更，重新加载）、`event: unavailable`（`{ reason }`：上游连不上，仍在重试），每 15 秒一个只带 `id` 的帧推进位置（还没有位置时是 `: heartbeat` 注释）。`id` 是转发器自己的位置（`<epoch>.<seq>`），不是 UNS 游标，只在上游能送达其后所有变更时才给：冷启动时上游第一次连上之前浏览器拿不到位置，连上后每个浏览器先收到 `reset`（`upstream-started`）再拿位置，所以上游就绪前读过的数据会重读。转发器记住最后的 UNS 位置：上游失败、或最后一个浏览器离开 30 秒后关闭，都从这个位置重开，epoch 不变、不漏、不 reset；只有 UNS 回 `reset`（游标过期、访问范围变化、集合重建）才换 epoch，等上游重新连上后给连着的浏览器发 `reset`。重连带 `Last-Event-ID` 时，在当前 epoch 的最近 1000 条里找得到就补发之后的，找不到（换了 epoch、太旧、伪造）就只给这个浏览器一个 `reset`。上游连不上（例如超过订阅上限的 429、`APP_NOT_READY`）时状态变成 `unavailable`：`onStatus` 回调、`logger.warn` 记一次、所有浏览器收到 `event: unavailable`；`relay.status` 可查。每个浏览器连接 10 分钟（±10%）后结束，浏览器重连时 App 的路由重新认证；`filter` 抛错的变更不发。转发器不发 `retry:`：重连节奏由浏览器端 `@tier0/sdk-v2/event-stream` 自己决定（平台错误、App 休眠、页面隐藏都在那里处理）；页面隐藏时断开，可见时带 `Last-Event-ID` 续传。

## 能力与入口

| 入口 | 能力 |
| --- | --- |
| `tier0.source` | 数据源、连接文档、影响分析、版本历史与运行观测 |
| `tier0.stream` | Runtime programs、原生文档、校验、部署、回滚与运行记录 |
| `tier0.streams` | App 请求、实时业务消息与独立交互能力发现 |
| `tier0.uns` | 目录、Topic、Collection、Record、Sample、事务与 App 数据上下文 |
| `tier0.system` | `whoami()`、`info()` |
| `tier0.members` | `listWorkspace()` 用于 Workspace 级成员选择；`listApp({ appId })` 查询能使用指定 App 的成员（Builder 预览按草稿角色，部署后按线上版本，`scope` 由 SDK 自动带上）（Tier0 App 里可用：每个 App 固定有 `platform.users.read`；App 的 Key 查到的响应不带邮箱） |
| `tier0.notifications` | `send()`、`get()` |
| `tier0.files` | `upload()`、`uploadMultipart()`、`resumeMultipart()`、`url()`、`download()`、`delete()`、`multipart` 原子接口 |
| `tier0.mqttAuth` | 创建、删除 MQTT 凭证 |
| `tier0.agent` | `analyses`、`canvases`、`cards`、`jobs`、`jobRuns`、`library`、`results` |
| `tier0.capabilities` | 当前凭证可见的能力发现；就绪状态由服务端判断 |
| `tier0.api` | 45 个平台 OpenAPI v2 的完整生成接口；通常优先使用上面的领域入口 |
| `@tier0/sdk-v2/mq` | MQTT WebSocket 客户端与 broker 地址工具；不进入根入口依赖图 |
| `@tier0/sdk-v2/source` | `createSourceClient()`，独立 Source 客户端 |
| `@tier0/sdk-v2/stream` | `createStreamClient()`，独立 Stream 客户端 |
| `@tier0/sdk-v2/streams` | Stream 交互客户端、错误类与消息类型 |
| `@tier0/sdk-v2/react` | `useTier0Query()`、`useTier0Mutation()`，需要 React 和 TanStack Query |
| `@tier0/sdk-v2/vue` | `useTier0Request()`，需要 Vue 3 |
| `@tier0/sdk-v2/server` | `parseVisitorHeader()` 解析访问者头；仅服务端 |
| `@tier0/sdk-v2/data` | App 数据层：`defineCollection()` 声明集合（含 TTL）、`createDataClient()` 首次访问时 ensure，按 collectionId 引用已有集合、Mongo 风格读写、带总数分页与封顶计数、原子批量与 `transact`、`subscribe` 变更订阅与 `createChangeRelay` 转发给浏览器、`runWithAbortSignal` 传请求中止信号；自动幂等键、并发上限与按 `retry.safe` 重试；仅服务端，需要 `zod` 4 |
| `@tier0/sdk-v2/data/define` | 集合声明与类型：`defineCollection()`、`Doc` / `NewDoc` 等、`compileCollection()`、`validateDocument()`；可进浏览器包，组件和 route 的客户端代码只从这里取声明和类型 |

集合声明必须分别提供稳定程序标识 `alias` 和业务名称 `name`，例如 `alias: 'production_orders'`、`name: '生产工单'`。目录、数据和引用直接用 name 展示，不提供 displayName 或名称回退；name 为 1–63 个 Unicode 字符，无首尾空白，不含 `/` 或空字符。ensure 按 alias 关联集合，仅首次创建设置 name，不覆盖用户改名。名称冲突时选择有区分度的业务名称，不拼随机后缀。

不保留 UNS v1、旧 Flow、`getCurrentProjectId()`、project 成员查询或 `/gw/reload`。Workspace 成员不等于能使用某个 App 的成员，不可用前者在客户端猜测 App 权限。

## SDK 方法与凭证权限

同一 SDK 支持工作空间集成和 App 运行时，方法存在不代表当前凭证可调用。`client.uns.namespace()` 调用的是 `POST /openapi/v2/uns/namespace/query`，属于 OpenAPI；有相应权限且未绑定 App 的 Agent / Personal Key 可以使用，App Key 当前不能使用。App 已知集合 ID 时可直接用 `recordFind` 读取记录；需要发现可访问集合及结构时使用 `client.uns.dataAppContext({})`。`appCollectionsList` 也是管理接口，不能作为 App Key 的替代入口。

SDK 不从 Key 前缀推断权限，也不在 403 后换凭证或回退内部接口。Agent 程序、SDK、MCP 都不能扩大所持凭证的权限。身份区别和排错见[命名空间查询与凭证](skills/tier0-sdk-v2/tier0-sdk-v2-uns/references/namespace.md)，App 读取示例见[查询集合与记录](skills/tier0-sdk-v2/tier0-sdk-v2-uns/references/read.md)。

## 本次接口退役

HTTP 调用统一使用 `/openapi/v2`。21 个重复 UNS 公共入口及生成方法直接移除，没有旧路由回退；升级 SDK 时需同时部署对应后端。

- Source 的 list/get/create/update、connection.update 改用 documents.*；Stream 的 programs.get/create/update/validate/disable 改用 documents.*，停用同时携带 expectedRevision 与字符串 expectedActiveVersion。
- 低层 findOneAnd* 改用 updateOne/replaceOne/deleteOne 的 returnDocument；批量新增用 bulkWrite 的 insertOne 项；元数据单条读取用 metadataFind + limit:1，去重用 aggregate。
- App 数据层的 insertMany、findOneAnd*、distinct 等便捷方法保留，由 SDK 映射到当前入口；insertMany 仍是单次原子请求，最多 200 项。
- Agent 的旧 nodes.searchSemantic/indexSync 和 relations.list/teach 没有 v2 契约，不再导出。旧 Controls 便捷入口、操作、DTO 和错误类不再导出，也没有兼容别名。

升级前应核对旧写请求的最终结果，包括集合初始化 seed。退役入口不再可调用，不能将未知结果的旧请求或幂等键直接改投新入口重做。当前入口的重试仍保留原路径、原键和原载荷。

`client.capabilities.discover()` 使用 `POST /openapi/v2/capabilities/discover` 和空对象，返回直接 JSON。能力发现使用合同 2.0，以 state、reasonCode 和 operations 表达结果，不再返回 enabled、allowed、releaseEnabled、availability；服务端必须同步部署该合同，只消费 Namespace、Source、Stream 管理能力，不以 App 交互域的版本标签作为前置条件。Source / Stream 的 `operations` 分别描述读取、配置、运行等操作，保留 `reasonCode`、`checkedAt`、`validUntil` 和 `requiresResourceCheck`；领域整体不可用时，读取或安全停用仍可能可用。证明到期后重新发现，实际操作仍需服务端检查具体资源权限和依赖。发现不代表设备在线或操作已成功，不自动重试。

## Source、Stream 与 UNS 分域

Source 认证配置与安全注入见 [Source 创建](skills/tier0-sdk-v2/tier0-sdk-v2-source/references/create.md)。通用 HTTP custom 的字段名是实际请求头名；Plex 模板的 `apiKey` 是厂商语义字段，两者不能直接互换。凭据通过专用凭据入口提交，不放入普通 headers 或脚本。

Stream 草稿保存、发布与运行是三个结果，分别核对。修订守卫、发布编号与未知结果恢复见 [Stream 发布](skills/tier0-sdk-v2/tier0-sdk-v2-stream/references/deploy.md)。运行时交互使用 `client.streams`。

随包的领域 Skills 可以独立使用，详细参数和示例放在各自 references 中。Tier0 Console 上传 Skill 时，将整个 `skills/tier0-sdk-v2/` 目录打包，保留相对链接。

## UNS 数据访问

App 自有集合用 `defineCollection` 声明业务 name、稳定 alias、实际 directoryPath 和 Schema，由数据层首次访问 ensure。已有集合用 `data.collection({collectionId})` 或 `client.uns.recordFind`，不 ensure、不写种子、不改变 ownerAppId；Builder 用自身系统身份完成目标 App 的授权，运行时 App Key 不能自行扩大授权。详见 [App 数据层](skills/tier0-sdk-v2/tier0-sdk-v2-data/SKILL.md) 与 [授权流程](skills/tier0-sdk-v2/tier0-sdk-v2-uns/references/update.md#已有集合授权给-app)。

已知集合 ID 直接读取，需要发现可用集合/Schema/有效权限时用 `dataAppContext`。原始 Record 返回 `{id,data,revision,...}`，数据层返回 `{_id,...业务字段,_meta}`，查询路径都直接写业务字段，不加 `data.`。

```ts
const page = await tier0.uns.recordFind({ collectionId: 'orders', limit: 20 });
const records = page.data.items;
```

Collection 存储仍受 Schema、索引和引用校验，JSONB 不等于自动转换。新数值字段使用 integer/int32 或 number/float|double；格式仅注解。ensure 只放宽，App 显式 schema:replace 先验证现存记录才允许收窄。回收集合保留数据与索引、既有授权可读历史；Record 删除会物理删除关联 Sample。

UNS 保留 `{code,msg,requestId,data}` 响应；单条写入按需用 returnDocument 取得原子快照。`int64` 超出安全范围返回 bigint，精确 JSON 数字用 UnsV2RawNumber；保留其类型，不经 Number/普通 JSON.stringify 做无损往返。

`client.uns` 不自动重试。错误的 execution/retry 区分未提交、部分提交与 unknown，unknown 先核对原意图，安全重试保留原请求和幂等键。数据层另有自动幂等键、并发控制及有限安全重试；取消请求不等于撤销写入。操作选择、分页、事务与回收见 [UNS 指南](skills/tier0-sdk-v2/tier0-sdk-v2-uns/SKILL.md)。

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

**在 Tier0 App 里**直接 `new Tier0MQClient()`，什么都不传：broker、Key 和 clientId 都取平台注入的值（见上文「aenv-next 运行环境」）。App 的 Key 只能收发自己命名空间里的主题 `apps/<TIER0_APP_ID>/<preview|deployed>/…`：预览的 Key 只能用 `preview` 段，部署的 Key 只能用 `deployed` 段，可发布可订阅，命名空间内可以用 `+` / `#`；别的 App 的主题、另一个运行环境的段和其他任何主题都会被 broker 拒绝。主题不在 App 设置里配置，也不需要管理员授权。Backend 按 Key 自己的运行环境决定段名（不看 clientId 和环境变量），没有运行环境的旧 Key 按 `deployed`；平台注入的 `TIER0_RUNTIME` 和 Key 的运行环境同词。

用 `appTopic(suffix)` 拼主题：它读 `TIER0_APP_ID` 和 `TIER0_RUNTIME`，返回 `apps/<TIER0_APP_ID>/<TIER0_RUNTIME>/<suffix>`；缺一个、App ID 不能当主题的一层，或 `TIER0_RUNTIME` 不是 `preview` / `deployed` 时抛错，不猜段名。`appTopic` 只在平台里（预览 / 部署）用，平台外会抛错；本地开发不要为它设 `TIER0_RUNTIME`，需要本地调试 MQTT 时自己写完整主题。

```ts
import { Tier0MQClient, appTopic } from '@tier0/sdk-v2/mq';

const mq = new Tier0MQClient();
await mq.connect();
mq.subscribe(appTopic('alarms/#'), (topic, payload) => { /* 处理消息 */ });
await mq.publish(appTopic('alarms/line-1'), { level: 'high' }, { qos: 1 });
```

不用 helper 时写成 `` `apps/${process.env.TIER0_APP_ID}/${process.env.TIER0_RUNTIME}/alarms/#` ``。设备和 UNS 数据变更不走这里：服务端订阅 Record 变更用 `@tier0/sdk-v2/data` 的 `data.subscribe`。

**App 之外的集成客户端**用 `mqttAuth` 创建的凭证，主题按这份凭证的授权：

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

MQTT 未配置 `password` 时可使用进程环境的 `TIER0_API_KEY`；显式传入 `password: undefined` 不会选择环境或已保存的 Key，`connect` 会拒绝。省略该字段则保留已有设置。已连接或自动重连中的客户端拒绝变更凭据时保持原连接及其身份，调用方必须处理错误；需要切换身份时先断开并创建新客户端。

MQTT 连接建立后，凭据和连接设置由底层客户端持有，包括自动重连期间。调用 `connect` 修改这些设置会报错，不会替换正在使用的凭据。换证时应停止旧客户端的业务操作、调用 `disconnect()`，再使用新凭据创建一个新的 `Tier0MQClient` 并重新注册订阅。旧客户端的 `disconnect()` 会清除 SDK 的订阅列表；它不是等待 Broker 确认断开的异步屏障。换证期间的消息可能丢失或重复，在途发布的结果也可能未知，应用需按业务协议处理，不能假定 SDK 已重放或恰好执行一次。Broker 撤销已经建立连接的生效时机取决于服务端认证、ACL 和缓存策略；仅更换客户端不能证明旧连接已被撤权。

首次连接正在建立时，`subscribe` 会等待连接；首次连接失败时撤销该订阅并报告错误。SDK 自己负责重连（见上文「aenv-next 运行环境」）：自动重连期间 `subscribe`、`connect` 等待重连完成，新订阅会登记，重连后与中断前已登记的订阅一起恢复，也可在恢复前取消；`publish` 交给同一底层客户端排队，重连后发出。客户端停止重连（浏览器授权失败）或调用 `disconnect()` 时，等待中的调用报错，等待中的新订阅撤销。

同一 topic 的多个 handler 共用一次 Broker 订阅和 SUBACK。SDK 同时检查报文及 mqtt.js 的授权结果；首次订阅或重连恢复若被 Broker 拒绝或确认不合法，该 topic 的 handler 会被移除，`error` 事件包含 topic，调用方可在处理原因后重新注册；其他 topic 不受影响。`connect` 事件仅表示连接建立，不表示所有订阅已获 Broker 确认。

`connect` 在启动底层客户端前检查地址和凭据；本地预检失败不会保存本次传入的设置。底层客户端已创建后若连接失败，其连接设置仍由该客户端持有，自动重连会继续使用这些设置（浏览器每次重连取新令牌，平台代理模式由节点代理填入 App 的 Key）；要改变凭据，需先断开并按上述方式重建。

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

写入验收不发布 Stream、不发送通知。归档资源保留正常产品恢复能力；报告区分通过、服务端拒绝和未验证范围。分片上传失败会保留错误原因，确认尚未尝试 complete 时清理本次会话；完成结果未知时先对账。

Stream 发布和实际运行使用单独的验收脚本，同样只在明确授权的测试 Workspace 执行；按脚本报告区分已测和未测的生命周期阶段：

```sh
node scripts/check-live-stream-runtime.mjs <consumer> <workspaceId> .tmp/live-stream-runtime.json --write-test-fixtures
```

业务项目锁定实际安装的版本并同步更新随包 Skills；本地检查不代表线上业务验收通过。

平台接口与能力发现的本地联调可分别运行 `node scripts/sync-contracts.mjs <backend> --worktree --platform-only` 和 `node scripts/sync-capability-contract.mjs <backend> --worktree`。预览来源明确记录基线和内容摘要，不能直接发布。Backend 提交后，将两条命令的 `--worktree` 替换为正式提交 SHA，再运行 `npm run generate && npm run check`；UNS 数据模型仍使用其独立固定输入。

Source 创建/更新与 Stream 创建/更新/部署的 dryRun 默认 false。凭据统一为 basic/oauth2/bearer/custom 等原生 kind，使用 username/secret/values，不使用 material/method。SQL 使用 edge-sql 与顶层 sql 固定查询。删除使用 source.documents.delete，换证使用 source.documents.credentials.update；远端 Edge 秘密在 Edge 本地预配。Stream 远端绑定传 target: {fleetNodeId,sourceId,configRevision}，服务端自动生成受控引用；不得与本地 sourceId/configRevision 同时传入。

## App Stream 交互与旧包迁移

`client.streams` 只在服务端用带 Key 的客户端（`createClient()`，读 `TIER0_API_HOST` / `TIER0_API_KEY`，或显式传 `apiHost` / `apiKey`）：`client.streams.requests.use({code}).invoke(input, {idempotencyKey})`、`client.streams.messages.use({topic}).subscribe(handler)`。浏览器不直接调平台，经 App 自己的服务端接口。Tier0 App 的 Key 可以用：Stream 请求和消息是 App 的固定能力，仍受工作区套餐约束；请求还要 Stream 请求授权给这个 App 授过对应的 request code；消息主题以已发布 Stream 的 manifest 为准（App 能订阅 Stream 声明发布的主题，能发布到有 Stream 订阅的主题），没有按 App 的主题配置（见 [Stream 交互](skills/tier0-sdk-v2/tier0-sdk-v2-streams/SKILL.md)）。订阅不再使用时 dispose，客户端退出时 `await client.dispose()`；请求与消息不会自动重放业务写入。

旧 `/cloud` 改用根入口，`/cloud/server` 改用 `/server`，`/openapi/react` 和 `/openapi/vue` 改用 `/react` 和 `/vue`。`/streams` 的现役能力已原生迁入本包；浏览器受信宿主（`/runtime`、`installAppRuntime`、`Symbol.for('tier0.sdk.app-runtime.v1')`）已删除，没有替代。Source/Stream 管理、文件、MQTT、通知、成员和集合继续使用本包现有入口；旧文件单例函数改为 `client.files` 对应方法。旧 `getCurrentProjectId`、Flow、Control 及项目接口已退役，不迁回。

| 旧包现役能力 | 统一后的入口与迁移方式 |
| --- | --- |
| 根入口、`/cloud` 的 `client` / `createClient` | `@tier0/sdk-v2` 根入口；同一实例提供数据管理和 App 交互 |
| Stream `describe` / `discover` / `invoke` | `client.streams.requests`；保留类型、幂等键和结果未知语义 |
| 消息 `publish` / `subscribe` / `onError` / `dispose` | `client.streams.messages`；原生 NATS WSS，消息需要 Node.js 22+；HTTP 仍支持 Node.js 20.19+ |
| 请求/invoke 能力发现 | `client.streams.capabilities.discover()`；`client.capabilities.discover()` 独立保留 Namespace/Source/Stream 作用域 |
| 访问者头 | `/server`（`parseVisitorHeader`） |
| Trusted runtime provider（`/runtime`） | 已删除；浏览器经 App 自己的服务端接口 |
| `unsV2`、平台操作、MQTT | `client.uns` / `client.source` / `client.stream`、现有平台入口、`/mq`；旧包全部现役公开操作已有对应 v2 操作 |
| `uploadFile` / `uploadFileMultipart` / `resumeMultipartUpload` | `client.files.upload` / `uploadMultipart` / `resumeMultipart`；上传选项与返回类型从 `/files` 导入 |
| `getFileUrl` / `downloadFile` / `deleteFile` | `client.files.url` / `download` / `delete`；download 返回原生 `Response` |
| 旧 React / Vue 每接口 hook | `/react` 的通用 query/mutation、`/vue` 的 `useTier0Request`；使用统一 client 和对应方法 |
| Project、Control、Flow 及旧配置版本入口 | 已退役，不提供别名或重新导出 |

真实消息本地验收用 `npm run test:streams:artifact`（Go、Node.js 22+、`nats-server`，通过 `TIER0_STREAM_MESSAGES_BACKEND_DIR` 指向 Backend checkout）。脚本用带 Key 的服务端客户端验证生产 Go issuer、TLS NATS、已安装 tarball 的 ESM/CJS，以及根入口的浏览器打包依赖闭包；固定夹具身份不代表线上 SYS/Gateway/App 权限链路。

代码存在不代表已发布。先构建并安装这次统一实现的不可变制品，更新 App 模板、依赖锁与存量 App，再移除旧包；不能用旧 npm 0.7.2 替代本分支构建。完整交互说明见 [Stream 交互](skills/tier0-sdk-v2/tier0-sdk-v2-streams/SKILL.md)。

Source/Stream 定向契约同步使用 `node scripts/sync-source-stream-contract.mjs <backend> <commit>`，然后 `npm run generate && npm run check`。该生成流程同步相关公开操作、路由、协议目录及依赖 schema，保留其余数据模型与平台输入的固定版本；来源和摘要记录在 contracts/uns-v2/provenance.json 的 source-stream-public 条目。`--worktree` 仅供预览，发布前必须重新固定已提交 SHA。
