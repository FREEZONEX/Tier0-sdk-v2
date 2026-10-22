---
name: tier0-sdk-v2-notifications
description: 使用 @tier0/sdk-v2 发送和查询 Tier0 站内通知、Web/Desktop 提醒及 Mobile 推送，处理 App 发送者、渠道、业务幂等和发送状态。
---

# 通知

在服务端使用 `client.notifications.send/get`。先确定真实收件人、通知内容与业务意图，发送操作应符合用户已授权的范围；只查通知状态时不补发通知。

## App 通知示例

```ts
import { createClient, getCurrentAppId } from '@tier0/sdk-v2';

export async function sendWorkOrderCompleted(recipientUserId: string, workOrderId: string) {
  const client = createClient();
  const result = await client.notifications.send({
    recipientUserId,
    type: 'business',
    title: '工单已完成',
    content: '工单 ' + workOrderId + ' 已完成，请查看处理结果。',
    idempotencyKey: 'work-order-completed:' + workOrderId,
    sender: { type: 'app', id: getCurrentAppId(), name: '工单应用' },
    channels: ['web', 'mobile'],
  });
  return { messageId: result.messageId, status: result.status };
}
export async function inspectNotification(messageId: string) {
  return createClient().notifications.get({ messageId });
}
```

`getCurrentAppId()` 读取平台注入的真实 APP_ID UUID。不要用 Folder、project 名称、工作空间 ID 代替；SDK 不自动注入 project 元数据。相同工单再次发生新的完成事件时，业务应增加事件版本，不能复用上一事件的意图键。

## 参数决策

| 参数 | 使用方法 |
| --- | --- |
| recipientUserId | 真实用户 ID 字符串；不是用户名或邮箱 |
| type/title/content | 必填；按产品定义的通知类型和内容构造 |
| idempotencyKey | 必填；同一收件人的同一次业务事件保持稳定 |
| sender | app 需真实 appId；other 可用于非 App 集成；system 仅内部服务 Key 可用 |
| link | 可选；业务导航目标，不能代替数据访问权限 |
| sender.meta | 可选展示信息，不能作为授权依据 |
| source | 已废弃的 sender.name 别名，新代码不再使用 |

多用户广播需要逐一确定收件人，并为各收件人的事件建立独立意图键。不要因超时每次生成新随机 key。

## 渠道

| channels 值 | 意义 |
| --- | --- |
| 省略 | 默认 web + mobile |
| `['web']` | Web/Desktop 提醒 |
| `['mobile']` | Mobile 推送 |
| `[]` | 只创建站内信 |
| 重复项 | SDK 去重 |

Desktop 归入 web，没有独立 desktop 渠道。显式单渠道不会被 SDK 补齐。

## 回执与失败

send 返回直接对象 `{ messageId, status, createdAt }`，不能读 `result.data.messageId`。发送被接受不等于收件人已经阅读；用 get 返回的 status、completedAt、errorCode、message 判断后续状态，不猜测尚未定义的状态枚举。

HTTP 错误抛 `ApiError`，保留 status/errorCode；结果未知时保留原 key，不自动重复发送。已有 messageId 就按该 ID 查回；没有 messageId 时当前 SDK 没有“按 idempotencyKey 查询”方法，不应编造查询入口。

需要按姓名找 Workspace 收件人时使用 [成员 Skill](../tier0-sdk-v2-members/SKILL.md)；Workspace 成员列表不等于 App 可访问成员名单。
