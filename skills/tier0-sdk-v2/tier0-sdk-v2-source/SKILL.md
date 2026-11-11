---
name: tier0-sdk-v2-source
description: 使用 @tier0/sdk-v2 的 client.source 管理 Source 连接和凭据，选择协议、查询资源与观测、处理更新和删除的修订及依赖影响。
---

# Source 连接管理

Source 保存连接、认证与资源声明；脚本执行见 [Stream](../tier0-sdk-v2-stream/SKILL.md)，业务存储见 [UNS](../tier0-sdk-v2-uns/SKILL.md)。使用服务端 `createClient()` 或显式配置 apiHost/apiKey，凭据不进入浏览器。

| 任务 | 参考 |
|---|---|
| 选协议、辨别普通 HTTP 与厂商模板 | [协议与能力](references/protocols.md) |
| 创建连接、导入凭据或自定义认证头 | [创建](references/create.md) |
| 查列表、配置、资源或健康状态 | [读取与诊断](references/read.md) |
| 更新连接、名称或凭据 | [修改](references/update.md) |
| 处理依赖影响 | [影响分析](references/changes.md) |
| 删除 Source | [删除](references/delete.md) |

只加载当前任务需要的参考。已有 Source、revision 和目标能力可直接复用。SourceDefinition 的 endpoint/role/http/sql/mqtt/modbus 等连接字段位于顶层，实际支持的组合由目标协议目录决定。

ID 保持字符串，expectedRevision 取自权威回执；Stream 使用 configRevision，两者不能互相推算。patch 保留未提供字段，完整替换需 full 文档。保存连接不会自动更新已发布 Stream。

调用返回 `{code,msg,requestId,data}`，创建/更新成功可直接使用 data 中的 Source view。dryRun 默认 false；预检按需执行。配置保存、连接健康、Stream 完成和业务落库分别核验。

Builder 使用自身系统 Key，不继承对话用户的权限。获授权的个人、Agent 或系统服务身份可管理 Source 与凭据；App 运行时 Key 不用于这些管理接口。遇到未知结局保存原请求、requestId 和幂等键，先对账；SDK 不自动重试，取消等待不会撤销服务端操作。
