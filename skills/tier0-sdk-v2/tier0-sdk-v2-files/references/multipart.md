# 分片上传、进度和中断

| 调用 | 行为 |
| --- | --- |
| files.upload(file) | 大于 100 MiB 自动分片 |
| files.uploadMultipart(file, options) | 非空文件显式分片，可报告进度 |
| files.multipart.init/partUrls/complete/abort | 原子接口，普通业务上传使用上面两个助手 |

| options 字段 | 类型 | 说明 |
| --- | --- | --- |
| partSize | number | 默认 8 MiB，至少 5 MiB；实际采用服务器返回值 |
| onProgress | function | 收到 uploadedBytes、totalBytes |
| signal | AbortSignal | 取消等待/传输 |
| 其余上传元数据 | string | 与 upload 相同 |

```ts
import { createClient, MultipartUploadError, type Tier0Client } from '@tier0/sdk-v2';

export async function uploadWithProgress(
  file: File, report: (uploadedBytes: number, totalBytes: number) => void,
  client: Tier0Client = createClient(), signal?: AbortSignal,
) {
  try {
    const saved = await client.files.uploadMultipart(file, {
      partSize: 8 * 1024 * 1024, signal,
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
```

成功后才持久化 filePath。中断 session 包含 fileKey、uploadId、parts（partNumber/etag）、completionAttempted；session 不是完成回执，不公开到日志或无关用户。

分片顺序上传，无自动重试、并发参数或一键续传。部分 PUT 可能成功但回执丢失，不能仅凭本地 parts 判断远端完整状态。跨域存储需要暴露 ETag 响应头。

completionAttempted=true 表示 complete 可能已提交，先对账最终文件，不能直接 abort 或重复 complete。明确放弃未完成会话时才调用 abort；初始化请求本身结果未知且无 session 时，保存错误信息交由平台对账，不猜 uploadId。
