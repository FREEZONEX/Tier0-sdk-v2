---
name: tier0-sdk-v2-stream
description: 使用 @tier0/sdk-v2 的 client.stream 创建和编辑 Stream、绑定 Source、发布或停用版本、检查运行与数据提交。App 调用已发布请求和实时消息使用 tier0-sdk-v2-streams。
---

# Stream 管理

`client.stream` 管理草稿、发布版本和运行；脚本中的 `api.sources/api.uns/api.stream` 属于平台执行器。连接和认证由 [Source](../tier0-sdk-v2-source/SKILL.md) 管理，业务存储由 [Collection](../tier0-sdk-v2-uns/SKILL.md) 管理，App 按需请求与消息见 [streams](../tier0-sdk-v2-streams/SKILL.md)。

使用持有当前管理权限的服务端客户端。Builder 的管理身份与 App 运行 Key 不同；App 能调用已授予的请求，不因此取得 Stream 管理权。按实际错误定位权限或配置，不因 403 自动换 Key。

## 按任务读取

| 任务 | 参考 |
| --- | --- |
| 新建、选触发器与 Source 绑定 | [create](references/create.md) |
| 编辑草稿 | [update](references/update.md) |
| 发布、停用、回滚 | [deploy](references/deploy.md) |
| 列表、完整文档、运行诊断 | [read](references/read.md) |
| HTTPServer 路由和提前回复 | [http-server](references/http-server.md) |
| 隔离样例与业务验收 | [lifecycle](references/lifecycle.md) |
| 删除 | [delete](references/delete.md) |

## 程序与数据边界

- 周期采集用 `api.stream.onTimer`（`every` 同义）；Source 事件用 `onMessage`；UNS Topic 变化用 `onEvent`；按需调用用带 request 合同的 `onRequest`。实时业务消息使用 `api.stream.messages`。
- 创建/修改接受互斥的 `program` 简写或原生 `document`，两者 script 都是 `{code,timeoutMs}`。program 使用 sourceBindings；原生 document 使用 sources 的 alias/resources。完整脚本为 `module.exports = api => { ... }`，Cloud timeoutMs 上限 30000。
- `resources:[]` 不代表任意协议资源授权；当前 Cloud HTTP client 会按通用 HTTP request 合同处理。原生操作应绑定目录中的精确资源。
- `return` 只返回处理结果。落库须显式 Collection `write`，使用符合 schema 的对象和稳定 recordId；缓冲写意图不等于已提交。
- 保存草稿、发布成功、真实执行和业务提交分别确认。sampleTest 的 writePreview 不写线上数据。

## 当前 Cloud 调用限制

交互式 `onRequest` 使用通用 HTTP `source.request` 时，即使方法为 GET，仍需 `sideEffect:"write"`、`idempotency:"required"`。厂商认证 Source 的通用 request 尚未贯通，使用该 Source 目录支持的原生操作；自定义路径不能仅改成 vendor 资源名。配置不兼容按 reason/path/repair 修正，不通过扩大 Builder 权限处理，也不把按需任务一律改成定时采集。

## 修订与执行结局

复用创建/更新回执中的完整文档与 revision。summary 不能用于回写；发生冲突或缺少快照时再 get。发布、停用、回滚使用 activeVersion 字符串作为 expectedActiveVersion；activeRelease 是关联运行的发布序号，不能互换。

写操作各自使用稳定意图键。结果未知保留原路径、请求体和键，先核对状态；恢复同一操作不换键。创建成功、发布失败时继续处理已有草稿。更改程序后的新业务意图另用新键，不自动重跑旧 unknown 任务。
