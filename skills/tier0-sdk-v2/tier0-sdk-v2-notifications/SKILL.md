---
name: tier0-sdk-v2-notifications
description: 使用 @tier0/sdk-v2 发送和查询 Tier0 站内通知、Web/Desktop 提醒及 Mobile 推送，解析收件人，处理发送者、渠道、业务幂等与投递状态。
---

# 通知

服务端使用 `createClient()` 读取 TIER0_API_HOST / TIER0_API_KEY，或显式传 apiHost/apiKey。发送必须符合用户已授权的收件人和内容范围，查询状态不自动补发。

| 任务 | 参考 | 方法 |
| --- | --- | --- |
| 收件人选择、完整发送、渠道、模式、错误 | [发送](references/send.md) | notifications.send |
| 查询回执、有界等待投递完成 | [查询](references/get.md) | notifications.get |
| 按姓名或邮箱查收件人 | [成员](../tier0-sdk-v2-members/SKILL.md) | members.listWorkspace |

## 核心约束

- type 固定 inbox；Swagger 的 string 不代表接受任意类型。
- 用人读姓名/邮箱选择收件人，ID 由成员数据解析并保持字符串，不让用户填写 ID。Workspace 成员不等于 App 可访问用户。
- title 最多50字符，content 最多800字符。mode 按真实发布环境选择 test/live；test 会创建测试消息，不能当预检。
- App sender 使用 getCurrentAppId() 的真实 APP_ID，导航和名称展示按目标前端支持核实。
- sender/link/meta 是展示提示，不作为授权。新代码不使用废弃 source 字段。
- 同一业务事件、收件人、内容使用稳定 idempotencyKey；新事件使用新键，不因超时随机换键。

## 渠道

| channels | 提醒范围 |
| --- | --- |
| 省略 | SDK 默认 web + mobile |
| ['web'] | Web/Desktop |
| ['mobile'] | 手机 |
| [] | 只建站内信 |

Desktop 属于 web，不存在 desktop 渠道。显式单渠道不补齐，重复项会去重。SDK 默认和裸后端省略参数的行为不同，不混用。

## 返回与失败

send 返回直接对象 {messageId,status,createdAt}，get 返回直接状态对象，没有 data 外层。accepted 表示受理，sent 表示已发送，不是用户已读；failed 检查 errorCode/message。

ApiError 提供 status/errorCode/msg。未知结果先对账；已有 messageId 按 ID 查，没有按 idempotencyKey 查询的 SDK 入口。HTTP SDK 不自动重试。

完整示例与参数边界均在操作参考中。Skill 示例不会自动发送消息，也不授予真实发送权限。
