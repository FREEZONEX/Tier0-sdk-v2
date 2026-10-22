# 查询通知投递状态

方法：`notifications.get({messageId})`；POST /openapi/v1/notifications/get。需要 notifications:read，与 send 权限独立；仅查询当前发送 Key 可见的消息。

| 参数/结果 | 类型 | 说明 |
| --- | --- | --- |
| messageId | string | 发送回执 ID，不转 Number |
| status | string | accepted / sent / failed |
| createdAt / completedAt | string | ISO 时间，completedAt 可省略 |
| errorCode / message | string | 失败原因，可省略 |

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function waitForNotification(
  messageId: string, client: Tier0Client = createClient(), maxAttempts = 10,
) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error('查询次数应为 1–20');
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await client.notifications.get({ messageId });
    if (result.status === 'sent' || result.status === 'failed') return result;
    if (result.status !== 'accepted') throw new Error('未识别的通知状态');
    if (attempt === maxAttempts - 1) return result;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('未取得通知状态');
}
```

accepted 表示仍处理，达到次数上限就返回处理中；sent 表示站内信已创建、推送交给渠道，不代表用户收到或阅读。failed 显示 errorCode/message，不继续当成功。

返回直接对象，不读取 result.data。404 MESSAGE_NOT_FOUND 也可能是发送 Key 不同，不能直接断言消息丢失；先核对原 messageId 与发送身份。查询任务不自动补发。
