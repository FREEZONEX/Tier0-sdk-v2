---
name: tier0-sdk-v2-stream
description: 使用 @tier0/sdk-v2 的 client.stream 创建、查询、修改和删除 Stream，绑定 Source，校验脚本，发布、停用、回滚及检查运行结果。
---

# Stream 处理与运行

应用代码使用 client.stream；外部连接用 [Source](../tier0-sdk-v2-source/SKILL.md)，集合和记录用 [UNS](../tier0-sdk-v2-uns/SKILL.md)。服务端 `createClient()` 读取 TIER0_API_HOST / TIER0_API_KEY，也可显式传 apiHost/apiKey。

## 按任务加载参考

| 用户任务 | 参考 | 方法 |
| --- | --- | --- |
| 新建并绑定 HTTP Client Source | [创建](references/create.md) | documents.create({program}) |
| HTTPServer 固定前缀与业务路由 | [HTTPServer](references/http-server.md) | documents.create({document})、api.stream.onRequest、ctx.reply |
| 列表、完整文档、运行记录 | [查询](references/read.md) | programs.list、documents.get、observations.get、runs.list |
| 修改草稿、脚本和绑定 | [修改](references/update.md) | documents.update（需要预览时 validate） |
| 发布、停用、版本回滚 | [部署](references/deploy.md) | programs.deploy/rollback、documents.disable |
| 删除 | [删除](references/delete.md) | programs.delete |
| 隔离样例测试、流程衔接 | [生命周期](references/lifecycle.md) | sampleTest |

## 两种文档形态

| 形态 | 完整输入 | 适用入口 |
| --- | --- | --- |
| Runtime program | name、script 字符串、sourceBindings、timeoutMs | documents.create/update/validate({program}) |
| 云端原生文档 | name、model、script 对象、sources、entries | documents.create/get/update/validate |

程序必须是完整 `module.exports = api => { ... }`，执行器 API 是 api.sources/api.uns/api.stream，与 npm 包的 client.source 不同。Runtime sourceBindings 为 sourceId/configRevision/acquisition；原生 sources 还使用 alias/resources。连接凭据不进脚本或 acquisition，秘密材料由 Source 执行宿主管理，不通过脚本读取、记录或返回。定时入口使用 api.stream.every；npm 的 client.controls 管理入口不作为 Goja 的 Stream 注册参数。

## 核心约束

1. documents.get({id,view:"summary"}) 返回安全摘要，不含可回写脚本；完整编辑使用 documents.get 或上次 documents.create/update 返回的完整文档。保留未修改的 sources/entries/script 字段。
2. create/update 保存草稿，不自动发布；documents 没有 deploy，云端 program 发布使用 programs.deploy。不能将已保存报告为已运行。
3. 所有更新/部署/删除携带当前 expectedRevision。原生停用另需 expectedActiveRelease，避免停掉他人刚发布的版本。
4. versionId 使用已知发布回执的 activeVersion，或从 versions.list 选定，不把 release 序号当 ID。expectedSourceRevision 仅用于恰好一个依赖源，不代表多个源的修订。
5. resources=[] 是空冻结资源集，不是通配符。写入本身由服务端校验，需要预览时单独 validate；当前云端程序 timeoutMs 上限 30000。
6. HTTPServer 响应时机在 Stream：普通返回等处理/提交完成；HTTP onRequest 内 await ctx.reply 可先回复一次再继续，仍受超时/并发/权限约束，断线不取消但 shutdown 可取消，不保证崩溃重放。
7. 仅执行用户要求的生命周期步骤；修改脚本不自动授予发布、停用或删除权限。

## 成功与异常

响应保留 code/msg/requestId/data。创建/更新回执的 revision 可直接用于发布；programs 发布回执的 activeRelease 是同次事务保存的正整数发布序号，无需前后 get。programs 回执和查询结果无活跃发布时省略 activeRelease，activeVersion 为字符串 0。校验要检查 valid，样例要检查 completed/failed，删除要检查 deleted；发布后按回执的 activeRelease 筛选 runs.list 才能确认该版本运行。样例 writePreview 不代表线上数据写入。

UnsV2OutcomeUnknownError、发布超时或取消后保留原路由、载荷和幂等键；允许恢复时原样重发取得原回执，不用新键重复发布。回执缺少 activeRelease 时不得用当前 head 替代。版本冲突先比较当前草稿，不能忽略 expectedRevision。不同写入意图使用不同键；本地 SDK 测试不能代替目标环境联调。
