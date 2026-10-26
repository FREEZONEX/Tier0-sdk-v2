# API Key 身份诊断

方法：`system.whoami()`；POST /openapi/v2/auth/whoami，无业务参数。不是调用其他 API 的强制前置步骤。

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function inspectCredential(client: Tier0Client = createClient()) {
  const identity = await client.system.whoami();
  return {
    workspaceId: String(identity.workspaceID), workspaceName: identity.workspaceName,
    keyType: identity.keyType, permissions: identity.permissions, roles: identity.roles,
  };
}
```

返回已解包的 userID/userName/email/workspaceID/workspaceName/apiKeyName/keyPrefix/permissions/roles/keyType。v2 对大整数保留 number|bigint，不能套用 v1 “一定已经丢精度”的描述；需要字符串时用 String，不先转 Number。

App Key 是共享业务凭证，不代表访问 App 的自然人。whoami 不能用于登录、当前用户、操作人审计或选择通知收件人；当前人来自应用认证会话，收件人从成员数据解析。

401 核对 Host/Key，403 核对权限；不要输出完整 Key、无差别展示邮箱或所有角色，也不自动换更高权限身份。
