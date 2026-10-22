---
name: tier0-sdk-v2-files
description: Implement uploads, attachments, avatars, file import/export, generated reports, downloads and persistent file storage in Tier0 Cloud Apps, even when the request does not mention Tier0 SDK.
---

Use `@tier0/sdk-v2` and the instance's `files` methods. Store runtime uploads and generated business files through platform object storage; persist the returned `filePath` in application data. Temporary signed URLs are not stable file references.

```ts
const saved = await client.files.upload(file);
const { fileUrl } = await client.files.url({ filePath: saved.filePath });
const response = await client.files.download({ filePath: saved.filePath });
```

The SDK requests upload authorization and then sends the signed form directly to storage. It does not forward the platform API key to storage. Do not manually add that key to upload/download requests or replace the storage API with direct S3 credentials.

Files above 100 MiB use multipart upload. `MultipartUploadError.session` contains the unfinished session and whether completion was attempted; reconcile before completing or aborting it. Automatic resume and mutation retries are not provided.

App/Sandbox local folders, public directories and database blobs are not a persistence substitute. Source files, versioned static assets, build output and disposable processing files are outside this rule. Platform keys stay in the server. See [file examples](../../README.md).
