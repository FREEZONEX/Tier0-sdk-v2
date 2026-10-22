# 发送通知

方法：`notifications.send(body)`；POST /openapi/v1/notifications/send。需要 notifications:send；收件人为当前 Workspace 内可用的成员，按[成员查询](../../tier0-sdk-v2-members/references/platform-members.md)解析。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| recipientUserId | string | 是 | 已解析的用户 ID，保持字符串 |
| type | inbox | 是 | 后端只接受 inbox；不是 business |
| title | string | 是 | 1–50 字符 |
| content | string | 是 | 1–800 字符 |
| idempotencyKey | string | 是 | 最多 128 字符；同一次业务事件固定 |
| mode | test/live | 否 | 根据实际发布环境显式选择；省略服务端默认 live |
| channels | array | 否 | SDK 省略补 web+mobile；[] 仅站内信 |
| sender | object | 否 | app/other；system 仅平台内部服务 Key |
| link | string | 否 | https:// 或单斜杠开头，最多 500 字符 |

## 完整 App 示例

下面函数供应用在已授权的业务事件中调用；写示例不意味着发送真实消息。intentKey 应包含收件人、业务对象和事件版本，不因网络重试换键。

```ts
import { createClient, getCurrentAppId, type Tier0Client } from '@tier0/sdk-v2';

export async function sendCompletedOrder(
  recipientUserId: string, orderId: string, intentKey: string, mode: 'test' | 'live',
  client: Tier0Client = createClient(),
) {
  return client.notifications.send({
    recipientUserId, type: 'inbox', title: '工单已完成',
    content: '工单 ' + orderId + ' 已完成，请查看处理结果。',
    idempotencyKey: intentKey, mode, channels: ['web', 'mobile'],
    sender: { type: 'app', id: getCurrentAppId() },
  });
}
```

sender.id 来自真实 APP_ID UUID。v2 不注入 project 上下文，也没有 getCurrentProjectId；不要把 Folder/Workspace ID 填进 meta.projectId。旧 UI 的 App 名称解析/打开 App 按钮依赖 appId+projectId，不能将旧导航规则原样承诺到新架构。需带链接时传已验证可访问的业务 https 地址，或确认目标前端支持的相对路由；缺少旧上下文时不猜拼地址。

other 发送者应给人读名称，如 `{type:'other',name:'库存同步服务'}`。app 不重复硬编码名称。sender/meta/link 都是展示导航提示，不是授权证明。meta 值为字符串，序列化最多 500 字节；sender.name 最多100字符。source 是废弃别名，不用于新代码。

## 渠道、模式与幂等

| channels | 提醒范围 |
| --- | --- |
| 省略 | SDK 显式发送 web+mobile |
| ['web'] | Web/Desktop |
| ['mobile'] | 手机 |
| [] | 只建站内信 |
| 重复项 | SDK 去重 |

没有 desktop 渠道。不要将 SDK 默认值与裸后端省略渠道的静默语义混淆。test 也会创建测试消息，不是 dryRun；仅因 NODE_ENV=production 不能证明 App 已发布。

同键同内容用于重放原意图；同键改内容产生冲突。新事件/不同收件人使用不同键。SDK 不自动重试，结果未知先对账；已有 messageId 用 get，没有按意图键查询的 SDK 方法。

## 回执与错误

成功为直接 {messageId,status,createdAt}，没有 data。accepted 是异步受理，sent 不是已读，详见[查询](get.md)。

v2 的 ApiError 已提供 status/errorCode/msg，不再 JSON.parse(error.msg) 提取旧版原始错误。

| HTTP / errorCode | 处理 |
| --- | --- |
| 400 INVALID_NOTIFICATION_TYPE | type 必须 inbox |
| 400 INVALID_REQUEST | 检查字段、枚举和长度 |
| 401 INVALID_CREDENTIAL | 核对注入身份 |
| 403 NOTIFICATION_NOT_ALLOWED | 核对 send 权限 |
| 404 RECIPIENT_NOT_AVAILABLE | 刷新成员并重新选择 |
| 409 IDEMPOTENCY_KEY_CONFLICT | 区分原事件与新事件，不静默换键重发 |
| 422 CONTENT_LIMIT_EXCEEDED | 缩短内容 |
| 429 NOTIFICATION_RATE_LIMITED | 有界退避；保留原键，不自动广播重发 |

link 拒绝 //host、反斜杠、Unicode 空白/控制/不可见格式字符。省略 link 不保证无按钮，实际导航还取决于发送者与目标前端。
