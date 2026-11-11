# 删除 Stream

`client.stream.programs.delete({id,expectedRevision,dryRun:false,idempotencyKey})` 删除指定 Stream。使用真实 ID 和当前修订；运行中的 Stream 可直接删除并撤销后续准入，不要求先停用。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function deleteStream(id: string, revision: number, intentKey: string, client: Tier0Client = createClient()) {
  return client.stream.programs.delete({id,expectedRevision:revision,dryRun:false,idempotencyKey:intentKey});
}
```

成功 data 为 `{id,revision,deleted:true}`；dryRun:true 返回预检结果，不代表删除。删除 Stream 不连带清理 Source 或 Collection 数据。版本冲突后重新比较状态；结果未知先核对，不把任意 get 错误当作已删除。
