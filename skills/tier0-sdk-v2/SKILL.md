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

```ts
import { createClient } from '@tier0/sdk-v2';

// 服务端注入 TIER0_API_HOST / TIER0_API_KEY。
export const client = createClient({ transportTimeoutMs: 30_000 });
export async function inspectConnection() {
  return client.system.info();
}
```

也可传 `apiHost`、`apiKey` 或 `getApiHost` / `getApiKey` 回调。API Key 留在服务端；不要生成 `VITE_*KEY` 或让页面携带 App Key。浏览器通过自己的服务端接口访问平台；App Stream 交互使用根入口 `client` 和受信宿主注入，无需设置密钥。消息要求 WebSocket（Node.js 22+ 或浏览器）。

不同身份使用独立实例。含员工数据委托时，每个入站请求新建实例，使用受信 App Gateway 提供的 `unsV2AppDataSubject`；它不是用户 ID，也不是 App 请求验签断言。不要从请求 JSON 拼造委托。身份验签流程见 [身份与框架集成](references/integration.md)。

## 返回值与错误

| 入口 | 成功值 | 失败类型 |
| --- | --- | --- |
| Source、Stream、UNS | 完整 `{ code, msg, requestId, data }` | `UnsV2Error` / `UnsV2OutcomeUnknownError` |
| 平台 v2，如 system、members、agent、mqttAuth | 解包后的 `data` | `ApiError` / `TransportError` |
| notifications | 直接对象，如 `messageId`、`status` | `ApiError` |
| capabilities | 专属响应对象 | `CapabilityError` |

方法存在不等于目标环境已部署或当前 Key 有权限。整数可能为 `bigint`；UNS 任意 JSON 中还可能含 `UnsV2RawNumber`。不要将标识符强制转为 Number；给浏览器返回数据时显式定义精确数字的序列化格式。

`createClient()` 的 HTTP 不自动重试。UNS 错误的 `execution` 说明执行到哪一步、`retry.safe` 说明能否用同一请求重发；带 `outcomeUnknown` 的失败应先对账，保留原意图键；取消请求不代表服务端撤销。App 数据层（`@tier0/sdk-v2/data`）会按 `retry.safe` 自动重试，见 App 数据 Skill。Source/Stream 仍使用底层 UNS v2 契约，所以错误类名保留 UNS，不代表它们仍属于数据入口。

## 从首版入口迁移

- `client.uns.sourceList(body)` → `client.source.documents.list(body)`。
- `client.uns.sourceDocumentGet(body)` → `client.source.documents.get(body)`。
- `client.uns.streamProgramDeploy(body)` → `client.stream.programs.deploy(body)`。
- `client.uns.streamDocumentValidate(body)` → `client.stream.documents.validate(body)`。
- `client.uns.recordFind(body)` 保持不变。
- 低层 `createUnsV2Client` 保留完整生成契约，供契约工具使用；业务主入口不再把 Source/Stream 管理混入 `client.uns`。

React/Vue 示例与验签见 [集成参考](references/integration.md)。完成接入时验证目标入口、真实身份、响应解包和错误分支；SDK 本地测试通过不代表环境联调完成。

Stream 请求与消息交互统一使用本包 `client.streams.requests` / `client.streams.messages`；[交互说明](tier0-sdk-v2-streams/SKILL.md)。Scaffold 只依赖本包；`client.stream` 管理接口与运行时交互用途不同。

本包公开 HTTP 入口统一为 `/openapi/v2`。旧的重复操作已退役，不生成兼容调用或回退。Source 配置用 documents.*，Stream 草稿用 documents.*、发布用 programs.deploy；App 数据层仍提供 insertMany/findOneAnd*/distinct 等便捷方法。历史旧写结果未知时先核对业务状态，不能转换路由后盲目重放。
