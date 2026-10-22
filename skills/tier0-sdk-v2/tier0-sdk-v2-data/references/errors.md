# 错误处理

数据调用的每一种失败都是 `DataError`；写入校验失败是 `ZodError`，不能存储的声明是 `CollectionSchemaError`。

| 字段 | 含义 |
| --- | --- |
| `status` | App 应回给自己调用方的 HTTP 状态：UNS 401 → 502（平台凭证问题，不是用户登出）；平台状态 `APP_NOT_READY` / `DEPENDENCY_UNAVAILABLE` / `CREDENTIAL_CHANGED` / `OUTCOME_UNKNOWN` / `TEMPORARILY_UNAVAILABLE` → 503；400/403/404/409/413/422/429 原样；其他 5xx → 502/503 |
| `code` | UNS 错误码（`DUPLICATE_KEY`…）或数据层错误码 |
| `reason` | UNS 错误体的稳定 `data.reason`，例如 `COLLECTION_NOT_FOUND` |
| `upstreamStatus` | UNS 实际返回的 HTTP 状态；未收到响应时为 0 |
| `requestId` | UNS 请求 ID，排障时一并记录 |
| `execution` | 执行到哪一步：`notStarted` / `rolledBack` 没有改动，`committed` 已生效，`unknown`（只出现在写入）可能已生效 |
| `retry` | `{ safe, afterMs? }`：同一调用能否稍后再发、建议等待多久。数据层已经按它自动重试过（最多 2 次） |
| `outcomeUnknown` | 即 `execution === 'unknown'`：写入可能已执行，先读回核对，再决定是否再写 |
| `attempts` | 本次调用实际发出的请求数（含重试）；发送前就失败时为 0 |
| `idempotencyKey` | 写入所用的幂等键（未显式传时为数据层生成的）；`outcomeUnknown` 时用同一个键重发同一写入不会重复生效 |
| `details` | UNS 错误体的 `data`（如 `conflicts`、`resource`、`missingPermission`），或数据层附带的详情 |
| `cause` | 原始 `UnsV2Error` |

按 `code` / `reason` 分支，不匹配 message 文本。

```ts
import { DataError } from '@tier0/sdk-v2/data';
import { ZodError } from 'zod';

/** 把数据层错误转成 App 自己的 HTTP 响应。 */
export function toResponse(error: unknown): Response {
  if (error instanceof DataError) {
    if (error.code === 'DUPLICATE_KEY') return Response.json({ error: '编号已存在', code: error.code }, { status: 409 });
    return Response.json({ error: error.message, code: error.code, requestId: error.requestId }, { status: error.status });
  }
  if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'Validation failed' }, { status: 400 });
  throw error;
}
```

## 数据层错误码

| code | 含义 |
| --- | --- |
| `DATA_NOT_CONFIGURED` (503) | 缺少 TIER0_API_HOST / TIER0_API_KEY（或 apiHost / apiKey） |
| `DATA_TIMEOUT` (503) | UNS 未在超时内应答（每次调用从开始算共 25 秒，含排队与重试，`transportTimeoutMs` 可调）；写入时 `outcomeUnknown` 为 true、不重试 |
| `DATA_OVERLOADED` (503) | 本进程 6 个请求名额一直占满，调用在超时前没排到，**没有发出**（`execution: 'notStarted'`，`retry.safe`）；减少并发或合并读取 |
| `DATA_ABORTED` (499) | 业务请求已中止（`runWithRequestContext(request, …)` 的 `request.signal`）：排队中的调用不再发出（`notStarted`），已发出的写入 `outcomeUnknown` |
| `DATA_UNREACHABLE` (503) | 连不上数据服务（读会自动重试）；网关地址只在原始错误里，不进 message |
| `HTTP_502` / `HTTP_503` / `HTTP_504` (503) | 网关在滚动发布、Pod 重启时未经 UNS 直接返回；读会自动重试，写入时 `outcomeUnknown` 为 true、不重试 |
| `DATA_BAD_RESPONSE` (502) | UNS 应答不符合契约 |
| `BATCH_LIMIT_EXCEEDED` (400) | 原子批量超过 200 项，未发送 |
| `WRITE_ERRORS` (409) | 批量写入有条目被拒；`details.writeErrors` 列出各条，`updateMany` / `deleteMany` 的 `details` 还有累计数量与 `resumeAfter`；`insertMany` / `bulkWrite` 是原子的，整批回滚 |
| `TRANSACTION_FAILED` (409) | 事务未提交；`details.results` 列出各步骤 |
| `SCHEMA_CONFLICT` (409) | Preview 下声明与存储冲突（部署环境记日志，冲突集合按已有 ID 继续服务） |
| `SCHEMA_WARNINGS` (500) | Preview 下 ensure 带警告（`REQUIRED_NOT_ENFORCED`、`INDEX_BUILD_FAILED`） |
| `COLLECTION_UNAVAILABLE` (503) | ensure 没有返回该集合（见服务端日志） |

`updateMany` / `deleteMany` 已提交一部分后失败（之前的页，或 UNS 报告的本页部分提交）时，错误保留失败的 `code` 与 `status`，但 `execution` 为 `'committed'`（失败页结局未知时为 `'unknown'`）、`retry.safe` 为 false；`details` 是整个调用的累计结果 `{ matchedCount, modifiedCount | deletedCount, status: 'partiallyCommitted', hasMore, resumeAfter }`，与 UNS 部分提交的错误体相同。用 `resumeAfter` 续做，不要整体重做。

## UNS 错误码

| code | 含义与处理 |
| --- | --- |
| `SCHEMA_CONFLICT` (409) | 声明无法与存储合并，没有任何改动。`data.conflicts` 列出 `{ alias, path, reason, current?, declared? }`：`TYPE_CONFLICT` → 换新字段名；`LIMIT_EXCEEDED` → 拆分结构；`JOIN_UNSUPPORTED` → 存储中有声明无法放宽的节点，用 `schema:replace` 修复；`DATA_RULE_FIELD` → 员工数据规则（owner/state 字段）在用该路径，保持必填且类型不变，或请管理员修改规则；`OPEN_OBJECT` → 用 `z.object`；`ALIAS_IN_USE` / `NAME_IN_USE` → 换 alias；`INVALID_INDEX` → 修正索引 |
| `ANNOTATION_NOT_APPLIED`（`ignored` 提示） | 不是错误：ensure 保留已存储的描述，用 `schema:replace` 应用修改 |
| `REQUIRED_NOT_ENFORCED`（警告） | 声明要求的字段在存储中仍是可选；改回可选，或回填后用 `schema:replace` 收窄 |
| `INDEX_BUILD_FAILED`（警告） | 已有记录违反新唯一索引；修正重复数据，下次 ensure 会重试建索引 |
| `UPSERT_REQUIRES_UNIQUE_INDEX` | upsert 过滤条件缺少 `_id` 或已就绪唯一索引的全部字段 |
| `DUPLICATE_KEY` (409) | 唯一索引拒绝该值；restore 时表示与活动记录冲突、未恢复任何记录 |
| `VERSION_CONFLICT` (409) | 记录在读取后已变化；重新读取后用新 revision 重试 |
| `OVERLOADED` (429) | 本 workspace 的数据请求超过并发份额，`retry.afterMs` 后可重试（数据层已自动重试）；页面读取要合并（`$in`、`findPage`、`countBy`），不要逐条循环调用 |
| `APP_NOT_READY` (503) | App 刚导入，平台仍在准备；数据层已自动重试，稍后再试 |
| `DEPENDENCY_UNAVAILABLE` (503) | 平台鉴权依赖暂不可用，稍后重试 |
| `CREDENTIAL_CHANGED` (409 → 503) | App Key 在请求执行期间被修改，写入已回滚；网关已自动重试一次 |
| `OUTCOME_UNKNOWN` (503) | 写入提交阶段连接断开，可能已生效；先读回核对 |
| `FEATURE_NOT_ENABLED` (403) | 工作区未开通 UNS v2 |
| `QUERY_TIMEOUT` (504 → 503) | 查询执行超时（`retry.safe` 为 false，不会自动重试）；按 `repair` 加有索引的条件或缩小范围 |
| `TEMPORARILY_UNAVAILABLE` (503) | 暂时性失败，数据层已按 `retry` 自动重试 |
| `APP_GRANT_REVOKED` (403) | 管理员撤销了本 App 对集合的授权；ensure 不会自动恢复，请管理员处理 |
| `APP_QUOTA_EXCEEDED` (409) | `data.resource` 指出触达的每 App 上限（64）：`collections` → 归档不用的集合；`indexes` → 从声明删索引并 `schema:replace`；`archivedCollections` → 恢复一个或请管理员清理 |
| `INDEX_QUOTA_EXCEEDED` (409) | Workspace 实际存在的索引已达 200；删除不用的索引 |
| `COLLECTION_TOO_LARGE` (409) | archive / restore 最多处理 2000 条记录（`data.maxRecords`）；不要归档大集合 |
| `FORBIDDEN` (403) | Key 不能做该操作（其他 App 或共享集合），或 Key 已吊销 |

记录调用上的 `data.reason`：`COLLECTION_NOT_GRANTED`（403，授权不覆盖该集合或操作）与 `COLLECTION_NOT_FOUND`（403/404，已归档或删除）会触发数据层重新 ensure；`APP_PERMISSION_MISSING`（403，`data.missingPermission`）表示 Key 缺少权限，例如删除记录需要 `uns.delete`——业务记录通常以状态结束（`CANCELLED`、`ARCHIVED`）而不是删除。
