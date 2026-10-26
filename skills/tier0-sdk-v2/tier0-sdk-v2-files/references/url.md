# 获取文件访问地址

方法：`files.url({filePath,expiredSec?,responseContentDisposition?}, {signal}?)`；GET /openapi/v2/assets/files/url。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| filePath | string | 是 | 上传返回的持久化引用 |
| expiredSec | number / bigint | 否 | 请求有效期（秒），由后端决定实际期限 |
| responseContentDisposition | string | 否 | 底层响应头提示，不代替浏览器保存动作 |

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function getPreview(filePath: string, client: Tier0Client = createClient()) {
  const result = await client.files.url({ filePath, expiredSec: 300 });
  return { url: result.fileUrl, expiresAt: result.expiresAt };
}
```

返回已解包的 fileUrl、可选 expiresAt。私有文件是短期签名 URL；公开文件可能是公开地址且无过期字段。不能对缺失 expiresAt 猜时间，也不能用普通 Number 强转大整数。

URL 适合图片预览、媒体引用或明确要求的临时分享。业务表仍保存 filePath。附件“下载”用[下载流程](download.md)，避免直接导航签名 URL 进入 PDF 预览器。分享链接不改变文件权限，也不允许把 API Key 拼进 URL。
