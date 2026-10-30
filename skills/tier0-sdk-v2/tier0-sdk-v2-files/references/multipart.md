# 分片上传、进度和续传

| 调用 | 行为 |
| --- | --- |
| files.upload(file) | 大于 100 MiB 自动分片 |
| files.upload(file, { multipart: options }) | 任意非空文件显式分片；业务元数据仍放在 multipart 外层 |
| files.uploadMultipart(file, options) | 非空文件显式分片，可报告进度 |
| files.resumeMultipart(file, session, options) | 复用会话，跳过已确认的分片，再提交完成 |
| files.multipart.init/partUrls/complete/abort | 原子接口，普通业务上传使用上面的助手 |

| options 字段 | 类型 | 说明 |
| --- | --- | --- |
| partSize | number | 默认 8 MiB，至少 5 MiB；实际采用服务器返回值 |
| concurrency | number | 默认 4，同时上传的分片上限，至少 1 |
| maxRetries | number | 默认 3，每个存储 PUT 的额外重试次数，可设为 0 |
| onProgress | function | 收到 uploadedBytes、totalBytes、doneParts、totalParts、percent（0–100） |
| signal | AbortSignal | 取消等待/传输 |
| 其余上传元数据 | string | 与 upload 相同 |

resumeMultipart 只接收 concurrency、maxRetries、onProgress、signal；文件元数据和服务器 partSize 来自 session。进度按收到 ETag 的已完成分片计算，续传时包含此前已完成的分片。

```ts
import { createClient, MultipartUploadError, type MultipartSession, type Tier0Client } from '@tier0/sdk-v2';

export async function uploadWithProgress(
  file: File, report: (uploadedBytes: number, totalBytes: number) => void,
  client: Tier0Client = createClient(), signal?: AbortSignal,
) {
  try {
    const saved = await client.files.uploadMultipart(file, {
      partSize: 8 * 1024 * 1024, concurrency: 4, maxRetries: 3, signal,
      onProgress: progress => report(progress.uploadedBytes, progress.totalBytes),
    });
    return { state: 'completed' as const, filePath: saved.filePath };
  } catch (error) {
    if (error instanceof MultipartUploadError) {
      return { state: 'interrupted' as const, session: error.session };
    }
    throw error;
  }
}

export async function resumeUpload(
  originalFile: File, session: MultipartSession,
  client: Tier0Client = createClient(), signal?: AbortSignal,
) {
  return client.files.resumeMultipart(originalFile, session, { concurrency: 4, signal });
}
```

成功后才持久化 filePath。中断 session 包含 fileKey、uploadId、parts（partNumber/etag）、completionAttempted，以及续传所需的 fileName、fileSize、服务器 partSize。会话不是完成回执，不公开到日志或无关用户。

失败时停止领取新分片，等待在途分片结束后返回稳定的 session；不会自动 abort 或在失败后暗中 complete。续传使用原文件（名称和大小必须匹配），保留已确认的 ETag，只重新传输缺少回执的分片。旧 session 若缺少文件信息或服务器 partSize，会明确拒绝续传，不推测分片边界。跨域存储需要暴露 ETag 响应头。

自动重试仅限同一签名地址、同一分片内容的存储 PUT 网络中断、超时或 HTTP 408/429/500/502/503/504；同一 uploadId/partNumber 的 PUT 可覆盖。401/403、用户取消以及平台 init/partUrls/complete 请求不会自动重试。存储请求不携带平台密钥。签名过期可再次 resumeMultipart 获取新的分片地址。

completionAttempted=true 表示 complete 已尝试提交，结果可能未知，resumeMultipart 会拒绝重放；先对账最终文件，不手动清除该标记或直接 abort。明确放弃未完成会话时才调用 abort；初始化请求本身结果未知且无 session 时，保存错误信息交由平台对账，不猜 uploadId。
