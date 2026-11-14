# 数据层错误处理

传输和服务端失败使用 DataError；本地写入验证抛 ZodError，不能编译的声明抛 CollectionSchemaError。按 code/reason 分支，不匹配 message。

| 字段 | 用途 |
| --- | --- |
| status / upstreamStatus | App 应返回的 HTTP 状态 / 上游实际状态 |
| code / reason / details | 稳定错误码、原因和定位信息 |
| requestId | 查询平台日志 |
| opId | 服务端明确定位的失败事务步骤；可能缺失，不从 message 或 details 推测，仍须结合 execution 判断结果 |
| execution | notStarted、rolledBack、committed、unknown |
| retry | 是否可安全原样重试及 afterMs；数据层已处理有限重试 |
| outcomeUnknown | 写入可能已执行，需核对 |
| idempotencyKey / attempts | 原意图键与实际请求次数 |

```ts
import { DataError } from '@tier0/sdk-v2/data';
import { ZodError } from 'zod';

export function toResponse(error: unknown): Response {
  if (error instanceof DataError) {
    return Response.json({ error: error.message, code: error.code, requestId: error.requestId }, { status: error.status });
  }
  if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'Validation failed' }, { status: 400 });
  throw error;
}
```

## 写入恢复

notStarted/rolledBack 表示没有提交；committed 可能是非原子批次部分完成；unknown 不能当作失败未执行。保留原意图键，核对 ID 和业务内容，而非只检查记录存在。仅 retry.safe 时原样重试，不用新键补发同一意图。

updateMany/deleteMany 部分失败的 details 是累计结果（matchedCount、modifiedCount/deletedCount、status:'partiallyCommitted'、resumeAfter）。已提交项不能整体重跑；unknown 页先核对。数据层已生成键并按服务端安全标记最多重试两次，不外加无条件循环。

## 常见错误

| code/reason | 处理 |
| --- | --- |
| DATA_NOT_CONFIGURED | 核对服务端 Host/Key 注入 |
| DATA_TIMEOUT / DATA_UNREACHABLE | 读可按错误重试，已发出的写入可能 unknown |
| DATA_OVERLOADED | 进程请求排队超时，notStarted；合并请求或降低并发 |
| DATA_ABORTED | 排队取消为 notStarted，已发出的写入可能 unknown |
| DATA_BAD_RESPONSE | 保存 requestId 和实际响应，排查契约 |
| BATCH_LIMIT_EXCEEDED | 原子批次拆到 200 项内 |
| VERSION_CONFLICT | 重读当前 revision，重新比较 |
| DUPLICATE_KEY | 检查唯一字段，恢复时检查活动记录冲突 |
| UPSERT_REQUIRES_UNIQUE_INDEX | 使用 _id 或 ready 唯一索引等值条件 |
| SCHEMA_CONFLICT / SCHEMA_WARNINGS | 查看 conflicts/warnings；不要用重建清空数据来修复 |
| SCHEMA_DATA_VIOLATION | 存量记录不满足替换 Schema，先处理实际数据兼容性 |
| SCHEMA_MIGRATION_TOO_LARGE | 超过结构收窄扫描限额，不表示已转换 |
| DIRECTORY_PATH_CONFLICT | 路径被归档目录或非目录对象占用 |
| DIRECTORY_PATH_NOT_APPLIED | ensure 保留现有目录；移动走元数据操作 |
| ANNOTATION_NOT_APPLIED | ensure 保留描述；显式结构替换才应用 |
| REQUIRED_NOT_ENFORCED | 存储仍可选，回填后才能收紧 |
| INDEX_BUILD_FAILED | 检查违反唯一约束的现存记录 |
| INDEX_NOT_READY | 声明的索引状态缺失或尚未 ready；停止依赖约束的写入，待平台完成后重新检查 |
| APP_DATA_POLICY_DISABLED / APP_GRANT_REVOKED | 明确停用/撤权，不能自动恢复 |
| COLLECTION_NOT_GRANTED | 授权不覆盖该集合或操作（见 collectionId/permission）；按任务所需补授权，不必找管理员：Builder 用 appDataPolicyGet/appDataPolicyUpdate [添加](../../tier0-sdk-v2-uns/references/update.md#已有集合授权给-app)，或由有 App 数据管理权限的人在 App 设置 → 数据中添加 |
| APP_PERMISSION_MISSING | 核对 App 的具体操作权限（data.missingPermission） |
| OWNER_APP_TRASHED / DIRECTORY_IN_TRASH | 从原 App/目录恢复回收批次 |
| APP_NOT_READY / DEPENDENCY_UNAVAILABLE / CREDENTIAL_CHANGED | 当前依赖暂不可用，遵循 execution/retry |
| QUERY_TIMEOUT | 缩小查询范围或增加适用索引，不能盲重试 |
| OVERLOADED / TEMPORARILY_UNAVAILABLE | 遵循 afterMs，SDK 已处理安全重试 |
| APP_QUOTA_EXCEEDED / INDEX_QUOTA_EXCEEDED | 查看 resource/限额；归档保留索引，不释放物理配额 |
| COLLECTION_TOO_LARGE | 检查返回限额；旧墓碑恢复仍可能受限，当前归档不逐条重写记录 |

权限问题与参数/Schema/连接问题分别处理，保留 code/reason/path，不把所有失败都归为权限不足。历史集合按既有未撤销授权可只读，不必为读取自动恢复或补建。

## 平台代理模式的错误

若运行环境通过平台代理附加凭据，带 `X-Tier0-Proxy:not-forwarded` 的错误表示请求没到平台，execution 为 notStarted。SDK 对其中可重试的 503/429 有内建处理。凭据、绑定或白名单问题按返回 code 处理，不复制 Key 到浏览器或另写绕过代理的请求。具体身份与环境配置见 [集成](../../references/integration.md)。
