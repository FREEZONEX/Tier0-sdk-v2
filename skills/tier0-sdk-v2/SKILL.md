---
name: tier0-sdk-v2
description: 使用 @tier0/sdk-v2 开发或迁移 Tier0 云端 TypeScript/JavaScript 应用：Source 数据源、Stream 处理程序、UNS 集合与记录、App 自有数据（@tier0/sdk-v2/data）、通知、文件存储、MQTT、成员、系统身份与能力和 Agent，按任务进入对应子 Skill，并处理配置、身份和框架集成。
---

# Tier0 SDK v2 应用集成

面向使用 `@tier0/sdk-v2` 的 TypeScript / JavaScript 应用。Node.js 20.19+；Stream 消息需要 Node.js 22+。包版本与生成契约见 package.json、contracts/upstream.json；目标环境是否支持某项操作，以部署契约与实际响应为准。

## 选择任务入口

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

## 初始化

```ts
import { createClient } from '@tier0/sdk-v2';

// 服务端读取 TIER0_API_HOST / TIER0_API_KEY；Tier0 App 运行时由平台注入。
export const client = createClient({ transportTimeoutMs: 30_000 });
export async function inspectConnection() {
  return client.system.info();
}
```

本地使用已有个人 Key 不要求先创建 App，见[本地连接](references/local-connection.md)。Key 留在服务端，浏览器调用自己的 App 服务端。显式凭证与逐请求身份配置见 [SDK 初始化](../../README.md#安装与初始化)；不同主体使用独立客户端。

## 身份边界

- Builder 使用自身系统身份管理工作区资源，包括为同一工作区的 App 关联已有集合；不继承对话用户的角色。具体规则见 [Collection 授权](tier0-sdk-v2-uns/references/update.md)。
- App 运行时使用 App Key，只能访问获授的集合与操作，不能管理 Source、Stream 或扩大自身数据授权。已知集合 ID 可直接读写；发现可用集合用 `client.uns.dataAppContext({})`。
- App 内谁能查看、修改哪些业务数据，由 App 服务端根据访问者角色判断；平台调用仍是 App 自身身份。访问者与 React/Vue 接入见[身份与框架集成](references/integration.md)。

## 响应与恢复

| 入口 | 成功值 | 失败类型 |
| --- | --- | --- |
| Source、Stream、UNS | 完整 `{code,msg,requestId,data}` | `UnsV2Error` / `UnsV2OutcomeUnknownError` |
| 平台 v2，如 system、members、agent | 解包后的 `data` | `ApiError` / `TransportError` |
| notifications | 直接对象 | `ApiError` |
| capabilities | 专属响应对象 | `CapabilityError` |

ID 与版本保持原始精度；整数可能为 bigint，UNS JSON 还可能含 `UnsV2RawNumber`。返回浏览器前显式序列化，不强转 Number。

底层 HTTP 不自动重试已转发请求。UNS 的 `execution` 表示执行状态，`retry.safe` 表示能否保留同一路径、载荷和幂等键重发。结果未知先读回对账，取消等待不代表撤销服务端操作。App 数据层另有自动重试策略，见 [App 数据](tier0-sdk-v2-data/SKILL.md)。

当前公开 HTTP 入口统一为 `/openapi/v2`。Source 配置用 `source.documents.*`，Stream 草稿用 `stream.documents.*`、发布用 `stream.programs.deploy`；`streams` 是运行时业务交互。旧入口升级说明见 [CHANGELOG](../../CHANGELOG.md)，不要为失败请求拼旧路由或更换身份重试。
