---
name: tier0-sdk-v2-data
description: 使用 @tier0/sdk-v2/data 在 App 服务端声明或引用 Collection，读写业务记录，开发统计报表和数据大屏，处理分页、索引、事务、订阅、Schema 演进和失败恢复。
---

# App Collection 数据层

Collection 持久化业务记录。App 服务端使用 `@tier0/sdk-v2/data`；需要外部采集时另用 Source 和 Stream。预览和部署共享同一批数据。

## 选择集合入口

- 新建 App 自有集合：`defineCollection({alias,name,directoryPath,schema,...})`，把声明放入 `createDataClient({collections})`。首次访问自动 ensure 全部声明，创建缺失集合、合并兼容扩展；无需手工初始化标记。
- 引用外部授权集合（推荐）：在 `appDataPolicy` 授权中设置唯一 `alias`，代码通过 `data.collection({alias:'equipment_master',schema})` 按别名动态解析物理 ID（可带本地写入校验 schema），严禁硬编码 `collectionId`；它永不 ensure、不写种子、不改变归属，管理员换绑后免重启生效，未绑定或撤权时抛出 `EXTERNAL_COLLECTION_UNBOUND`（503）。时序采样接口使用 `await data.resolveCollectionId({alias:'telemetry'})` 获取物理 ID。旧式 `{collectionId}` 仅用于兼容存量代码。Builder 关联目标 App 的授权，见 [已有集合授权](../tier0-sdk-v2-uns/references/update.md#已有集合授权给-app)。
- 管理工作区目录、Schema 或一次性数据修复：使用 [原始 UNS 接口](../tier0-sdk-v2-uns/SKILL.md)。

已知 ID 时直接读写；需要发现集合和有效权限时调用 `client.uns.dataAppContext({})`。`dataState:"uninitialized"` 是新 App 正常空态，不必等到 ready 才开发。明确停用策略或撤权不能当初始化失败自动恢复。

## 运行方式

平台注入 `TIER0_API_HOST/TIER0_API_KEY`，SDK 以 App 身份调用。浏览器访问 App 自己的业务接口，服务端按可信访问者角色处理记录权限，见 [身份集成](../references/integration.md)。Builder 的管理身份与运行时 App 身份不同。

数据运行时依赖 Node，只在服务端导入 `/data`。声明和类型可从 `/data/define` 导入浏览器；需要 Zod 4。每个进程、每组固定 Host/Key 使用一个 client；切换主体或轮换 Key 后新建实例。

SDK 返回扁平文档 `{_id,...业务字段,_meta}`，原始 UNS 返回 `{id,data,revision,...}`。两者查询路径都直接使用业务字段，不加 data.。

列表、搜索、报表和普通详情在服务端完成鉴权与范围过滤后直接返回。多项读取需要同一请求快照时用 `queryBatch`。普通查询省略读后的 `data.transact` 版本复核。

| 任务 | 参考 |
| --- | --- |
| 声明/引用集合、Schema、业务目录、唯一键、TTL、种子（查询索引由平台自动建） | [建模](references/modeling.md) |
| 查询与写入、批量、分页、订阅和浏览器转发 | [读写](references/read-write.md) |
| 统计报表、大屏、首屏查询和分页字节预算 | [统计报表与大屏](references/read-write.md#统计报表与大屏) |
| 状态流转、revision、跨集合事务、取消与初始化 | [一致性](references/consistency.md) |
| 加字段、改类型、收窄结构 | [Schema 演进](references/schema-evolution.md) |
| 错误与未知写入结果 | [错误处理](references/errors.md) |
| 请求 ID、排队/尝试耗时与重试观察 | [请求诊断](references/diagnostics.md) |

普通写入由数据层生成幂等键并执行有依据的安全重试；同一业务意图需跨调用恢复时显式传稳定 idempotencyKey。不再外套无条件重试循环。
