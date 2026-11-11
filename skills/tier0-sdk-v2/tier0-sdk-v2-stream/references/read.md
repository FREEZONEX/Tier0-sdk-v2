# 查询与运行诊断

| SDK 方法 | 输入 | 结果 |
| --- | --- | --- |
| programs.list | page、size、search、sourceId、status、archived | list、total、hasMore、nextPage |
| documents.get | id、view:summary/full | 草稿状态与修订；full 含 document、可能含 activeDocument |
| observations.get | id | 运行窗口与积压 |
| runs.list | id、size、cursor | items、nextCursor |
| programs.versions.list | id、page、size | 历史版本，含 versionId |

summary 用于显示，full 用于编辑。完整脚本读取需要管理权限；已有写回执时复用其文档和 revision。列表从 page=1 开始，按返回的分页字段推进，不把某页空结果当作全库不存在。

## 观察本次发布

runs.list 没有服务端 release 过滤参数，用发布回执的 activeRelease 逐页匹配：

```ts
import { createClient, type Tier0Client, type UnsV2Integer } from '@tier0/sdk-v2';

export async function readPublishedRuns(
  id: string, release: UnsV2Integer, cursor?: string, client: Tier0Client = createClient(),
) {
  if (typeof release === 'number' && !Number.isSafeInteger(release)) throw new Error('Exact release integer required');
  if (BigInt(String(release)) <= 0n) throw new Error('Published release required');
  const {data} = await client.stream.runs.list({id,size:100,...(cursor ? {cursor} : {})});
  return {...data,items:data.items.filter(run => String(run.release) === String(release))};
}
```

此函数只读取一页；有 nextCursor 时仍可能存在匹配运行。观察新运行重新查第一页。匹配后还须核对 entryId、时间和 status；仅有运行记录不等于成功。草稿可能领先于 activeDocument，不用旧运行证明新草稿生效。

## 解释错误

读取 error 的 code/stage/reason/path/repair（以当前响应提供的字段为准），保留 requestId 和运行标识。校验组合不兼容应修正配置；权限错误按真实原因处理，不凭 403 直接要求扩权。

平台对 HTTP URL/查询参数格式错误返回 400，真实权限或 Source 范围拒绝返回 403，依赖不可用返回 503；上游 HTTP 响应的 status 另行判断，不混为平台授权失败。

`SOURCE_TARGET_SCOPE_MISMATCH` 指请求超出 Source 绑定范围。`sourceRequest:notDispatched` 只证明该次请求未发送，不能推断整个 Stream 没有先前副作用。`SOURCE_HTTP_401` 等表示宿主观察到上游响应，仍可能与最终 unknown 同时出现；`RESULT_UNKNOWN` 不允许自动重试。

`completed` 可能零输出。采集落库要按稳定键读回目标 Record/Sample；读回失败作为独立证据缺口，不覆盖已确认的运行结局。业务提交后消息发布失败也不撤销已提交记录。旧记录未给具体 error 时保留未知，不拼造原因。

App Stream 授权列表的 `blockedReasons` 区分下列原因；`configuredActive:1` 只说明配置授权有效，不保证当前能执行。

| 原因 | 含义 |
| --- | --- |
| `execution_identity_denied` | SYS 拒绝当前执行身份 |
| `execution_identity_unavailable` | 身份服务不可用 |
| `execution_identity_mismatch` | 身份响应与请求不匹配 |
| `runtime_unavailable` | 执行运行时不可用 |
| `source_binding_unavailable` | Source 状态、访问权限或凭据绑定不可用 |

旧服务的 `deployer_unavailable` 没有这些区分，不能据此断定 Builder 权限不足。保留原始原因与 requestId，恢复依赖或修正实际配置后再验证。
