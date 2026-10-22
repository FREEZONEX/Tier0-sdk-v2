# 删除文件

方法：`files.delete({filePath}, {signal}?)`；POST /openapi/v1/assets/files/delete。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| filePath | string | 是 | 业务记录中已确认目标的上传引用 |
| signal | AbortSignal | 否 | 第二参数；取消客户端等待 |

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function deleteAttachment(filePath: string, client: Tier0Client = createClient()) {
  const result = await client.files.delete({ filePath });
  if (!result.deleted) throw new Error('平台未确认文件已删除');
  return { deleted: true };
}
```

删除前明确目标及业务引用，读取/下载不附带删除。返回已解包的 {deleted}；不要复制 v1 把 204/空体也无条件视为成功的逻辑。v2 要按实际回执判断。

对象删除不提供 SDK 恢复功能。401/403 处理身份与授权；网络中断/结果未知时先对账，不把错误当“已经不存在”，不自动换身份重试。
