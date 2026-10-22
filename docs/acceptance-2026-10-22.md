# SDK v2 安装包与开发环境验收

日期：2026-10-22。包：`@tier0/sdk-v2@0.1.0`。

结论：安装包和本地自动化通过；多组真实业务操作通过，但不能宣称“所有功能已可用”。Source 创建预检、Control 权限、Stream 能力查询、Agent 真实用户身份及文件分片传输仍有阻断或限制。通知发送等未执行的功能单独列出。

## 测试对象与方法

- 测试 Workspace：`374897752781296`。网页 `https://dev.tier0.cn`，SDK API Host **`https://api-dev.tier0.cn`**。
- 使用用户提供的 service Key，先以 `system.whoami()` 验证 Workspace。凭据仅进入测试进程环境，没有写入文件、安装包或 Git。
- 后端契约固定版本：`1e93620522caa47869d67e9aea1491a8cda71fa5`。未修改后端或部署配置。
- `npm pack` 后在独立 consumer 中安装 `.tgz`。真实环境脚本从这个 consumer 加载 SDK；Skill 工作流提取的是安装包中的 Markdown 代码。
- 写入仅针对本次生成的 `sdkv2-20261022-*` 资源。Source 不启用，Stream 只保存草稿。

## 安装包检查

| 检查 | 结果 |
| --- | --- |
| 源码行为测试 | 580 / 580，15 个文件 |
| 安装后行为测试 | 580 / 580，同套断言，导入目标为包内 dist |
| 全部生成操作路由 | 50 个 v1 + 98 个 v2，每个实际请求本地 HTTP fixture |
| Skills | 11 个；62 个 TypeScript 示例对源码及包内声明类型检查通过 |
| 使用形式 | ESM、CommonJS、声明导出、独立包安装、浏览器 bundle 通过 |
| 调试映射 | JS map 内嵌源码；不再提供指向包外源码的声明 map |

路由 smoke 检查证明方法、路径和基本传输可用，不证明每个业务字段或每种服务端状态已验收。已有测试另外覆盖无损整数、超时/取消、写入结果未知、不自动重试、凭据隔离、对象存储无平台凭据以及 Skill 的主要生命周期。

## 真实环境结果

| 功能 | 结果与范围 |
| --- | --- |
| 系统、成员、能力发现 | whoami、info、Workspace 成员列表、capabilities.discover 通过 |
| Source 查询 | 协议列表、配置列表、原生文档列表通过；读到 7 个现有 Source |
| Source 创建 | 原生文档 dryRun 返回 HTTP 503 / TEMPORARILY_UNAVAILABLE，消息 `cloud lifecycle service unavailable`；未继续提交创建，因此修改/删除/连接采集未验收 |
| Stream | 读取原有 9 个 Stream；新建独立 timer 草稿、校验、读回、按原生文档修改、删除及归档读回通过 |
| Stream runtime capabilities | HTTP 403 / FORBIDDEN，`API key operation not allowed`；不代表所有 Stream 接口都不可用 |
| UNS 集合与记录 | 创建、读取、修改、删除/归档、恢复和最终清理通过；执行包内 Skill 示例 |
| UNS 目录与 Topic | 创建、读回、修改、归档、恢复、再次归档通过 |
| UNS 采样与查询 | 采样追加、历史、最新值、聚合、范围删除及空结果核对；记录 count/distinct 通过 |
| UNS 并发和事务 | 记录加锁、续租、解锁；事务 dryRun、提交和读回；changes poll 通过 |
| 文件普通上传 | 上传测试文本、签名 URL、下载内容逐字比对、删除通过 |
| 文件分片 | 6 MiB、两片测试未完成。初始化和签名 API 返回 200，第一片向 OSS S3 endpoint 的 PUT 在 30 秒和诊断用 60 秒期限内均未完成；错误为 AbortError，尚不能区分网络与服务配置根因。两次未完成会话均已 abort 成功 |
| MQTT | 使用同一 service Key 连接 `wss://mqtt-dev.tier0.cn:8084/mqtt` 成功，已断开 |
| Control | discover 返回 HTTP 403 / CONTROL_FORBIDDEN；未调用实际控制设备 |
| Agent | library/results/canvases 列表通过；当前画布列表为空，未构造虚假 canvasId 测卡片。jobs.list 返回业务码 100012：任务管理需要真实用户身份，内部服务虚拟负责人不能代替 |
| 通知 | 本地请求与状态查询测试通过；真实发送未执行，未向任何成员发送验收消息 |

Source 的 503 是后端返回的统一生命周期错误。对固定版本代码的检查表明它可包装多种内部失败，因此本报告不把它进一步断言为某个具体服务宕机或数据库故障。SDK 正确抛出了服务端错误。

## 未验收范围

不能从上述通过项推断 Source 探测/启用/真实采集、Source 绑定 Stream 的端到端数据链、Stream 发布/停用/回滚/真实运行、MQTT 发布订阅消息闭环及凭证创建撤销、通知真实投递、Control 执行、Agent 任务/卡片/即时分析写入已经可用。React/Vue 完成类型和打包检查，未在实际应用页面中进行组件交互验收。

全量业务验收需要先解决 Source 和分片阻断，并提供相应功能允许的身份、权限和测试对象。权限失败不能通过 SDK 绕过；当前 service Key 不应被当作真实用户身份。

## 清理与复现

最终以 SDK 按测试前缀检索，活跃 Source、Stream、集合、目录、Topic 均为 0。创建过的业务资源使用平台归档语义清理，归档历史保留；测试文本对象已删除，未完成分片会话已终止。

复现入口：

- `npm run check`：自动打包、安装并执行包内行为测试，不触及线上。
- `scripts/check-live-readonly.mjs`：仅查询，检查 Workspace 绑定，报告不保存原始业务响应。
- `scripts/check-live-workflows.mjs`：需显式 `--write-test-fixtures`，可用 `TIER0_TEST_DOMAINS=uns,extended` 选择扩展 UNS 验收。
- `scripts/check-live-transports.mjs`：普通 API 鉴权、分片传输和 MQTT 连接诊断；只记录状态、耗时与存储 origin，不记录签名查询字符串。

本次安装包用于本地分发与验收，未发布到 npm。
