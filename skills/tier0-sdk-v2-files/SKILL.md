---
name: tier0-sdk-v2-files
description: 使用 @tier0/sdk-v2 实现 Tier0 应用附件、头像、导入导出、生成报告、上传下载和持久化文件引用，包括分片上传及中断处理。
---

# 文件与附件

业务文件使用平台对象存储，数据库保存返回的 filePath。App 本地目录可用于临时处理和构建，但不能替代持久化上传。使用服务端 client.files，API Key 不下发给浏览器或对象存储。

## 上传并保存引用

```ts
import { createClient } from '@tier0/sdk-v2';

export async function uploadReport(text: string) {
  const client = createClient();
  const file = new File([text], 'report.txt', { type: 'text/plain;charset=utf-8' });
  const saved = await client.files.upload(file);
  // 将 filePath 保存到业务记录；临时 URL 到期后重新获取。
  return { filePath: saved.filePath };
}
export async function downloadFile(filePath: string) {
  const response = await createClient().files.download({ filePath });
  return response.arrayBuffer();
}
export async function getTemporaryLink(filePath: string) {
  return createClient().files.url({ filePath, expiredSec: 300 });
}
```

upload 接收 Web File；Node 20.19+ 可直接构造。若文件来自磁盘，先读取内容构造 File，别把本地路径字符串当文件参数。大文件避免全部读入内存后重复复制；按业务运行环境决定流转方式。

## 上传协议与参数

- `upload(file, options)` 自动填写 fileName/contentType/size；options 支持平台定义的 business/useBy/visibility/sessionId/appInstanceId 与 signal，不猜测这些字段的合法业务枚举。
- 普通上传先向平台申请 postUrl/postFields，再向对象存储提交表单，file 必须排在签名字段之后。SDK 已处理，不能手工附带平台 Authorization。
- filePath 为持久化引用；fileUrl 为临时地址。发通知或生成页面时，按当前权限重新请求临时 URL。
- 下载通过平台申请签名地址后匿名读取，使用 `client.files.download`，不要手动跟随携带 API Key 的下载重定向。

## 分片上传

超过 100 MiB 自动分片，也可显式调用：

```ts
import { createClient, MultipartUploadError } from '@tier0/sdk-v2';

export async function uploadLargeFile(file: File, signal?: AbortSignal) {
  try {
    return await createClient().files.uploadMultipart(file, {
      partSize: 8 * 1024 * 1024, signal,
      onProgress: ({ uploadedBytes, totalBytes }) => {
        console.info({ uploadedBytes, totalBytes });
      },
    });
  } catch (error) {
    if (error instanceof MultipartUploadError) {
      // 交给受控的作业存储保留 session；不要自动 complete/abort。
      return { interrupted: true as const, session: error.session };
    }
    throw error;
  }
}
```

partSize 至少 5 MiB；SDK 使用服务端返回的实际分片大小，首版顺序上传，不自动重试/续传。中断 session 含 fileKey、uploadId、已成功 parts/ETag、completionAttempted；它是恢复依据，不是上传成功回执。

`files.multipart` 提供 init/partUrls/complete/abort 原子接口。继续已有分片时保留服务端 ETag；跨域直传还需要存储暴露 ETag 响应头。completionAttempted=true 时先核对最终文件是否存在，不能盲目重新完成或终止。当前 SDK 未提供自动列举远端分片的恢复助手。

## 删除与失败

`files.delete({ filePath })` 返回 `{ deleted }`，deleted=false 不能显示“已删除”。删除前按业务引用关系处理，读取/下载请求不附带删除。

平台阶段抛 ApiError/TransportError，存储阶段还可能抛 fetch/Abort 错误；不要吞掉上传失败后仍保存“成功”记录。上传/下载超时覆盖取得响应头阶段，返回 Response 的后续流由调用方消费和管理。
