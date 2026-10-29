# 上传并保存文件引用

使用 `client.files.upload(file, options)`；独立入口为 `createFilesClient`（@tier0/sdk-v2/files）。Node.js 20.19+。浏览器只调用应用自己的上传接口，平台 Key 留在服务端。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| file | File | 是 | 名称、MIME、大小从 File 读取；不是磁盘路径字符串 |
| options.business / useBy | string | 否 | 平台定义的业务归属，不猜枚举 |
| options.visibility | string | 否 | 根据业务授权选择公开或私有，不自动公开 |
| options.sessionId / appInstanceId | string | 否 | 真实运行上下文，不用 projectId 替代 |
| options.signal | AbortSignal | 否 | 取消等待/上传，不保证服务端回滚 |

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function uploadAttachment(file: File, client: Tier0Client = createClient()) {
  const saved = await client.files.upload(file);
  if (!saved.filePath) throw new Error('上传回执缺少 filePath');
  return { filePath: saved.filePath };
}
```

上传流程：平台 prepareUpload 返回 postUrl/postFields/filePath → SDK 按签名字段在前、file 在后构建表单 → 匿名上传存储。不要给对象存储附带平台 Authorization。上传失败时不能将准备阶段返回的 filePath 当成功附件保存。

业务表持久化 filePath；临时签名 URL 不作为长期引用。文件写入和业务记录写入不是原子事务，业务保存失败时记录待清理对象，只在任务授权范围内清理。

文件大于 100 MiB 时自动分片；阈值不是单文件产品上限，套餐配额/文件类型限制由后端决定。需要进度时显式用 [uploadMultipart](multipart.md)。
