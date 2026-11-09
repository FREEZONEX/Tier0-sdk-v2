---
name: tier0-sdk-v2
description: 使用 @tier0/sdk-v2 开发或迁移 Tier0 云端 TypeScript/JavaScript 应用：Source 数据源、Stream 处理程序、UNS 集合与记录、App 自有数据（@tier0/sdk-v2/data）、通知、文件存储、MQTT、成员、系统身份与能力和 Agent，按任务进入对应子 Skill，并处理配置、身份和框架集成。
---

# Tier0 SDK v2 应用集成

面向应用代码编写；运行时为 Node.js 20.19+。独立包 `@tier0/sdk-v2` 的版本以 package.json 为准（UNS v2 契约 5.0.0），是否可从 npm 安装须检查实际发布状态；未发布时安装仓库构建的 tarball。新参数还需要目标环境部署对应后端，不能只凭 SDK 方法存在判断可用。

## 选择业务入口

| 用户要做什么 | SDK 入口 | 深入说明 |
| --- | --- | --- |
| 连接外部系统、维护采集源、检查连接和影响范围 | `client.source` | [Source](tier0-sdk-v2-source/SKILL.md) |
| 编写处理程序、配置源绑定、校验和发布、查运行记录 | `client.stream` | [Stream](tier0-sdk-v2-stream/SKILL.md) |
| 调用业务请求、发布或订阅业务消息、查询 App 交互能力 | `client.streams` | [App Stream 交互](tier0-sdk-v2-streams/SKILL.md) |
| 集合、目录、Topic、业务记录、历史采样与事务 | `client.uns` | [UNS](tier0-sdk-v2-uns/SKILL.md) |
| App 自有业务数据：声明集合、Mongo 风格读写与事务 | `@tier0/sdk-v2/data` | [App 数据](tier0-sdk-v2-data/SKILL.md) |
| 站内信、Web/Desktop 提醒、手机推送 | `client.notifications` | [通知](tier0-sdk-v2-notifications/SKILL.md) |
| 当前凭证、平台信息、功能是否就绪 | `client.system`、`client.capabilities` | [系统](tier0-sdk-v2-system/SKILL.md) |
| 附件、头像、导入导出、生成报告 | `client.files` | [文件](tier0-sdk-v2-files/SKILL.md) |
| 实时主题订阅/发布 | `@tier0/sdk-v2/mq`、`client.mqttAuth` | [MQTT](tier0-sdk-v2-mq/SKILL.md) |
| Workspace 收件人/成员检索、App 可用成员 | `client.members` | [成员](tier0-sdk-v2-members/SKILL.md) |
| Agent 作业、运行、分析结果和卡片 | `client.agent` | [Agent](tier0-sdk-v2-agent/SKILL.md) |

每个领域 Skill 可单独使用，无需先加载本文件。Source → Stream → UNS 是接入、处理与数据存储三个领域；不是要求每个数据读取场景都创建一套流水线。通知和系统能力独立于这条链路。

## 初始化与身份

个人 Key 可直接读取已有集合，无需创建平台 App；网关配置、运行示例与排错见[本地连接指南](references/local-connection.md)。

```ts
import { createClient } from '@tier0/sdk-v2';

// 平台注入 TIER0_API_HOST 和 App 的 Key TIER0_API_KEY；本地开发自己设这两个。
export const client = createClient({ transportTimeoutMs: 30_000 });
export async function inspectConnection() {
  return client.system.info();
}
```

也可传 `apiHost`、`apiKey` 或 `getApiHost` / `getApiKey` 回调。API Key 留在服务端；不要生成 `VITE_*KEY` 或让页面携带 App Key。浏览器通过自己的服务端接口访问平台；App Stream 交互（`client.streams`）也只在服务端用带 Key 的客户端。消息要求 Node.js 22+（WebSocket）。

凭证来源按属性存在性选择，优先顺序为 `apiKeyProvider`、`apiKey`、`getApiKey`；只有都未提供才读取 `TIER0_API_KEY`。显式 `undefined` 或 getter 返回 `undefined` 不会回退到环境 Key。每个用户请求使用独立客户端，不要把全局 `configureClient` 当作请求身份。

**Tier0 预览和部署里，App 的 Key 在运行进程的环境里**：平台注入 `TIER0_API_KEY`（这个 App 的 Key，秘密；预览是 preview Key，部署是 deployed Key）和 `TIER0_API_HOST`，`createClient()` 直接用它们，只发一个 `X-API-Key`。App 代码不要自己读、复制、打印或下发这个 Key，也不要生成或硬编码 Key；直接调平台时也通过 SDK。身份读平台设置的 `TIER0_WORKSPACE_ID`、`TIER0_APP_ID`。

App 的 Key 只能调 `/openapi/v2/uns/**`、`assets/**`、`notifications/send`、`platform/getMembers`（`members.listWorkspace()`）、`apps/access-members/list`（`members.listApp()`）、`info`；其他接口（`system.whoami()`、`notifications.get`、`mqttAuth`、`capabilities`、`agent`、`client.streams`）回 403 `hosted_app_key_route_forbidden`，平台接口再按 App 的平台权限判定；Source / Stream 管理接口 App 的 Key 无权调用，Backend 回 403。平台权限和消息主题由工作区管理员在 App 设置里管理，改了立即生效；外部集合在发布时确认。没有 `TIER0_API_KEY` 而 `TIER0_RUNTIME` 为 `deployed` / `preview` 时 SDK 进入平台代理模式（不发凭据、带 `X-Tier0-SDK: 1`），当前平台不会出现这种运行时，见 [错误码](tier0-sdk-v2-data/references/errors.md#平台代理模式的错误)。

不同身份使用独立实例。App 调平台只有一种身份：App 自身。当前用户和角色从前门注入的 `X-Tier0-Visitor` 读（`parseVisitorHeader`），按角色决定谁能看、能改什么由 App 在服务端自己做，见 [身份与框架集成](references/integration.md)。

## 返回值与错误

| 入口 | 成功值 | 失败类型 |
| --- | --- | --- |
| Source、Stream、UNS | 完整 `{ code, msg, requestId, data }` | `UnsV2Error` / `UnsV2OutcomeUnknownError` |
| 平台 v2，如 system、members、agent、mqttAuth | 解包后的 `data` | `ApiError` / `TransportError` |
| notifications | 直接对象，如 `messageId`、`status` | `ApiError` |
| capabilities | 专属响应对象 | `CapabilityError` |

方法存在不等于目标环境已部署或当前 Key 有权限。整数可能为 `bigint`；UNS 任意 JSON 中还可能含 `UnsV2RawNumber`。不要将标识符强制转为 Number；给浏览器返回数据时显式定义精确数字的序列化格式。

`createClient()` 的 HTTP 不自动重试，唯一例外是平台代理模式下代理自己产生的 `503` / `429`（带 `X-Tier0-Proxy: not-forwarded`，请求没有到达平台），SDK 按 `retry_after_ms` 最多重试 3 次；平台返回的 5xx 不重试。UNS 错误的 `execution` 说明执行到哪一步、`retry.safe` 说明能否用同一请求重发；带 `outcomeUnknown` 的失败应先对账，保留原意图键；取消请求不代表服务端撤销。App 数据层（`@tier0/sdk-v2/data`）会按 `retry.safe` 自动重试，见 App 数据 Skill。Source/Stream 仍使用底层 UNS v2 契约，所以错误类名保留 UNS，不代表它们仍属于数据入口。

## 从首版入口迁移

- `client.uns.sourceList(body)` → `client.source.documents.list(body)`。
- `client.uns.sourceDocumentGet(body)` → `client.source.documents.get(body)`。
- `client.uns.streamProgramDeploy(body)` → `client.stream.programs.deploy(body)`。
- `client.uns.streamDocumentValidate(body)` → `client.stream.documents.validate(body)`。
- `client.uns.recordFind(body)` 保持不变。
- 低层 `createUnsV2Client` 保留完整生成契约，供契约工具使用；业务主入口不再把 Source/Stream 管理混入 `client.uns`。

访问者身份与 React/Vue 示例见 [集成参考](references/integration.md)。完成接入时验证目标入口、真实身份、响应解包和错误分支；SDK 本地测试通过不代表环境联调完成。

Stream 请求与消息交互统一使用本包 `client.streams.requests` / `client.streams.messages`；[交互说明](tier0-sdk-v2-streams/SKILL.md)。Scaffold 只依赖本包；`client.stream` 管理接口与运行时交互用途不同。

本包公开 HTTP 入口统一为 `/openapi/v2`。旧的重复操作已退役，不生成兼容调用或回退。Source 配置用 documents.*，Stream 草稿用 documents.*、发布用 programs.deploy；App 数据层仍提供 insertMany/findOneAnd*/distinct 等便捷方法。历史旧写结果未知时先核对业务状态，不能转换路由后盲目重放。
