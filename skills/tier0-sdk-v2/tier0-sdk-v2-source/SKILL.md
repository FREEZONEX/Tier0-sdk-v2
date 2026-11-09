---
name: tier0-sdk-v2-source
description: 使用 @tier0/sdk-v2 的 client.source 查询、创建、修改和删除新架构 Source，配置协议连接、处理影响分析、版本冲突与运行观测。
---

# Source 数据接入

Source 维护连接配置、认证引用与源状态。脚本处理用 [Stream](../tier0-sdk-v2-stream/SKILL.md)，数据存储用 [UNS](../tier0-sdk-v2-uns/SKILL.md)。服务端使用 `createClient({apiHost,apiKey})`，或注入 TIER0_API_HOST / TIER0_API_KEY 后 `createClient()`；密钥不进入浏览器。Tier0 App 的 Key 无权调 Source 管理接口，Backend 拒绝（403）。

## 按任务加载参考

| 用户任务 | 参考 | SDK 方法 |
| --- | --- | --- |
| 选协议、准备连接配置 | [协议配置](references/protocols.md) | protocols.list |
| 创建 HTTP/SQL 带凭据源 | [创建](references/create.md) | documents.create |
| 列表、详情、运行状态 | [查询](references/read.md) | documents.list/get、observations.get、runtime.get |
| 修改名称、端点或配置 | [修改](references/update.md) | documents.update |
| 查看修改/删除影响 | [影响分析](references/changes.md) | impact |
| 禁用后删除并核验 | [删除](references/delete.md) | documents.state.update、documents.delete |

先加载对应操作文档，使用其中的参数表、完整请求及返回判断。只执行用户任务所需步骤；示例函数调用才会执行写入，导入不执行。新建→查询→修改→删除可组成生命周期，但查询任务不触发其他操作。

## 核心约束

1. Source 配置使用 documents.*，原生文档为 SourceDefinition，连接字段 endpoint/role/http/sql/mqtt/modbus 等位于顶层，与 Enterprise 一致。HTTP API 使用 http-api；OAuth 为 oauth2；SQL 为 edge-sql；Modbus TCP 为 modbus-tcp。Server 托管入口的路由和响应时机由 Stream 定义。
2. 已有 ID 和 revision 时优先用 documents.update 的 patch，避免额外 get；完整替换 document 前读取完整文档，安全列表摘要不能无损回写。原生 ID 是十进制字符串，revision 原样传递，不转 Number。
3. 现有 Source 修改、删除都要 expectedRevision。仅修改名称、描述可直接提交；修改连接配置或删除时，没有任何 Stream 引用可直接提交，有草稿、活动、历史或不可见引用则需 confirmedImpactRevision。先形成精确意图，再读取全部影响分页；回执不可合成、跨意图复用或静默刷新。提供的回执始终严格校验，不自动获取并同意影响。
4. 配置中保留 credentialRef，不写秘密。创建专用 credentials 与 documents.credentials.update 使用原生 kind 和 username/secret/values；OAuth 非秘密配置在 http.oauth。删除使用 documents.delete；不再调用 source.delete 或 credentials.create。远端 Edge 凭据在本地预配，云端只使用批准的 target 绑定。
5. Source 创建后即可供 Stream 使用，不提供启停开关。删除 Source 后停止后续使用；runtimeState 和 health 是运行观测，不是用户开关。保存配置不代表 Stream 已切换至新 configRevision。

## 返回值与异常

所有调用返回完整 code/msg/requestId/data。documents.create/update 的预检返回 validated/sideEffects，提交返回完整 Source view，可直接使用其中的文档和 revision，无需额外 get；批量删除返回 Outcome。只有 committed 且无项错误才可报告提交成功；accepted/jobId 继续查询作业。创建、更新的 dryRun 默认 false；预检按需使用，不是每次提交的必经步骤。

需要查看历史用 source.history({id,beforeRevision,size})，按 nextBeforeRevision 继续；探测用 source.probe，其外部系统访问应属于当前任务。配置校验或连接探测成功不证明某个 Stream 请求已获授权或采集成功，实际结果看对应发布的 runs。连接配置修改使用 documents.update，遵守同一影响确认契约。

UnsV2Error 表示已知拒绝；UnsV2OutcomeUnknownError 表示可能已写入。保存 requestId、原请求和意图键，先查详情/历史/作业对账。取消等待不撤销服务端操作；SDK 不自动重试。权限不足不能解释为资源不存在。
