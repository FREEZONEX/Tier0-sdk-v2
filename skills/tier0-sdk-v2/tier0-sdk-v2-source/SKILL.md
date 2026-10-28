---
name: tier0-sdk-v2-source
description: 使用 @tier0/sdk-v2 的 client.source 查询、创建、修改、启停和删除新架构 Source，配置协议连接、处理影响分析、版本冲突与运行观测。
---

# Source 数据接入

Source 维护连接配置、认证引用与源状态。脚本处理用 [Stream](../tier0-sdk-v2-stream/SKILL.md)，数据存储用 [UNS](../tier0-sdk-v2-uns/SKILL.md)。服务端使用 `createClient({apiHost,apiKey})`，或注入 TIER0_API_HOST / TIER0_API_KEY 后 `createClient()`；密钥不进入浏览器。

## 按任务加载参考

| 用户任务 | 参考 | SDK 方法 |
| --- | --- | --- |
| 选协议、准备连接配置 | [协议配置](references/protocols.md) | protocols.list |
| 创建 HTTP/带凭据源 | [创建](references/create.md) | documents.create |
| 列表、详情、运行状态 | [查询](references/read.md) | documents.list/get、observations.get、runtime.get |
| 修改名称、端点或配置 | [修改](references/update.md) | documents.update |
| 查看修改/启停/删除影响 | [影响分析](references/changes.md) | impact |
| 启用、停用 | [状态变更](references/state.md) | state.update |
| 删除并核验 | [删除](references/delete.md) | delete |

先加载对应操作文档，使用其中的参数表、完整请求及返回判断。只执行用户任务所需步骤；示例函数调用才会执行写入，导入不执行。新建→查询→修改→删除可组成生命周期，但查询任务不触发其他操作。

## 核心约束

1. Source 配置统一使用 documents.*，原生文档为 `{name,protocol,config}`，HTTP API 显式指定 `config.role`。HTTP 统一为 `protocol: http-api` + `config.role: client/server`；Client 主动请求，Server 接收入站请求，不能互换。HTTPServer 统一接收入站请求，固定前缀后的路由和响应时机属于 Stream；旧 http_push 不再用于新建。
2. 已有 ID 和 revision 时优先用 documents.update 的 patch，避免额外 get；完整替换 document 前读取完整文档，安全列表摘要不能无损回写。原生 ID 是十进制字符串，revision 原样传递，不转 Number。
3. 现有 Source 修改、启停、删除都要 expectedRevision。没有任何 Stream 引用时可直接提交；有草稿、活动、历史或不可见引用时仍需 confirmedImpactRevision。先形成精确意图，再读取全部影响分页；回执不可合成、跨意图复用或静默刷新。提供的回执始终严格校验，不自动获取并同意影响。
4. 配置中保留认证/TLS 引用，不写明文秘密；HTTP Client 新凭据走创建专用 credentials；Server 不携带 Client auth/TLS 配置。
5. desiredState 不代表实际健康，保存配置不代表 Stream 已切换至新 configRevision。运行状态另行读取。

## 返回值与异常

所有调用返回完整 code/msg/requestId/data。documents.create/update 的预检返回 validated/sideEffects，提交返回完整 Source view，可直接使用其中的文档和 revision，无需额外 get；批量状态/删除返回 Outcome。只有 committed 且无项错误才可报告提交成功；accepted/jobId 继续查询作业。预检按需使用，不是每次提交的必经步骤。

需要查看历史用 source.history({id,beforeRevision,size})，按 nextBeforeRevision 继续；探测用 source.probe，其外部系统访问应属于当前任务。连接配置修改使用 documents.update，遵守同一影响确认契约。

UnsV2Error 表示已知拒绝；UnsV2OutcomeUnknownError 表示可能已写入。保存 requestId、原请求和意图键，先查详情/历史/作业对账。取消等待不撤销服务端操作；SDK 不自动重试。权限不足不能解释为资源不存在。
