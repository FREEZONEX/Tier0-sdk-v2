# 下载与应用附件保存

v2 方法：`files.download({filePath,…}, {signal}?) → Promise<Response>`。返回值本身就是 Response。

v2 先请求文件 URL，再匿名读取对象存储；不沿用带 Key 的重定向下载链。平台认证信息不能转发给存储。

## 同源服务端下载

应用路由先校验登录和业务权限，再按业务记录 ID 从数据库取可信 filePath。下例只负责已经授权后的转发，不可直接暴露为接受任意 filePath 的公共接口。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function streamAuthorizedAttachment(
  filePath: string, client: Tier0Client = createClient(), signal?: AbortSignal,
) {
  const upstream = await client.files.download({ filePath }, { signal });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'Cache-Control': 'private, no-store',
    },
  });
}
```

大文件直接转发 response.body，避免服务端先完整 buffer。返回响应头后的流消费/取消由应用管理；SDK 请求超时不覆盖后续所有流读取。

## 浏览器保存

浏览器访问自己的业务下载路由，不持有平台 Key。下面的路由是应用需要实现的接口。

```ts
export async function saveAttachment(recordId: string, fileName: string) {
  const response = await fetch('/api/attachments/' + encodeURIComponent(recordId) + '/download');
  if (!response.ok) throw new Error('附件下载失败');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Blob 方案会占用浏览器内存；超大文件按应用支持的流式保存能力设计。不能将权限失败当空文件下载，也不能将文件不存在当成网络异常重试。
