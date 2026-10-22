---
name: tier0-sdk-v2-stream
description: 使用 @tier0/sdk-v2 的 client.stream 创建、查询、修改和删除 Stream，绑定 Source，校验脚本，发布、停用、回滚及检查运行结果。
---

# Stream 处理与运行

应用代码使用 client.stream；外部连接用 [Source](../tier0-sdk-v2-source/SKILL.md)，集合和记录用 [UNS](../tier0-sdk-v2-uns/SKILL.md)。服务端 `createClient()` 读取 TIER0_API_HOST / TIER0_API_KEY，也可显式传 apiHost/apiKey。

## 按任务加载参考

| 用户任务 | 参考 | 方法 |
| --- | --- | --- |
| 新建并绑定 HTTP Source | [创建](references/create.md) | programs.validate/create |
| 列表、完整文档、运行记录 | [查询](references/read.md) | programs.list/get、documents.get、observations.get、runs.list |
| 修改草稿、脚本和绑定 | [修改](references/update.md) | documents.validate/update |
| 发布、停用、版本回滚 | [部署](references/deploy.md) | programs.deploy/rollback、documents.disable |
| 删除并核验归档 | [删除](references/delete.md) | programs.delete |
| 隔离样例测试、流程衔接 | [生命周期](references/lifecycle.md) | sampleTest |

## 两种文档形态

| 形态 | 完整输入 | 适用入口 |
| --- | --- | --- |
| Runtime program | name、sdkVersion、script 字符串、sourceBindings、timeoutMs | programs.create/update/validate |
| 云端原生文档 | name、model、script 对象、sources、entries | documents.create/get/update/validate |

程序必须是完整 `module.exports = api => { ... }`，执行器 API 是 api.sources/api.uns/api.stream，与 npm 包的 client.source 不同。Runtime sourceBindings 为 sourceId/configRevision/acquisition；原生 sources 还使用 alias/resources。连接凭据不进脚本或 acquisition。

## 核心约束

1. programs.get 返回脱敏摘要，不含可回写脚本；编辑必须 documents.get。保留未修改的 sources/entries/script 字段。
2. create/update 保存草稿，不自动发布；documents 没有 deploy，云端 program 发布使用 programs.deploy。不能将已保存报告为已运行。
3. 所有更新/部署/删除携带当前 expectedRevision。原生停用另需 expectedActiveRelease，避免停掉他人刚发布的版本。
4. versionId 从 versions.list 取得，不把 release 序号当 ID。expectedSourceRevision 仅用于恰好一个依赖源，不代表多个源的修订。
5. resources=[] 是空冻结资源集，不是通配符。先查询 runtime.capabilities，并让服务端 validate 检查能力；当前云端程序 timeoutMs 上限 30000。
6. 仅执行用户要求的生命周期步骤；修改脚本不自动授予发布、停用或删除权限。

## 成功与异常

响应保留 code/msg/requestId/data。校验要检查 valid，样例要检查 completed/failed，删除要检查 deleted，发布要检查 activeVersion 和观测。样例 writePreview 不代表线上数据写入。

UnsV2OutcomeUnknownError、发布超时或取消后先读取版本/观测对账，保留原请求意图键，不自动重复发布。版本冲突先比较当前草稿，不能忽略 expectedRevision。不同写入意图使用不同键；本地 SDK 测试不能代替目标环境联调。
