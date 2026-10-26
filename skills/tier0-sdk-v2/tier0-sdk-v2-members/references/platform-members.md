# Workspace 成员查询与选择

方法：`members.listWorkspace(body)`；POST /openapi/v2/platform/getMembers。查询当前 Key 所属 Workspace；云端需要 uns:read。通知读写权限不自动包含成员查询。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| keyword | string | 姓名、昵称、邮箱关键词 |
| roleKey / roles | string / string[] | 单个或多个角色筛选，组合为 OR |
| statuses | string[] | active / disabled；选择通知收件人通常 active |
| updatedAtStart / updatedAtEnd | string | RFC3339，包含边界 |
| page | number / bigint | 从 1 开始，默认 1 |
| size | number / bigint | 默认 20，最大 100 |

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function memberOptions(keyword: string, page = 1, client: Tier0Client = createClient()) {
  const result = await client.members.listWorkspace({ keyword, statuses: ['active'], page, size: 20 });
  return {
    options: result.list.map(member => ({
      value: member.userId,
      label: member.nickName || member.userName || member.email || '未命名成员',
      email: member.email, roles: member.roles.map(role => role.roleName || role.roleKey),
    })),
    total: result.total, page: result.page, size: result.size,
  };
}
```

v2 返回已解包的 list/total/page/size，不读 result.data。userId、roleId 保持字符串；value 留作内部选项值，用户看到姓名/邮箱/角色，不让用户填写 ID。不确定匹配时展示候选人，不默认选第一项。

内置公开角色 owner/builder/operator；筛选兼容性以服务端为准，匹配后仍返回成员全部角色。不要根据某个角色名自行推断 App 访问授权。

## 有界分页同步

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

export async function* scanMembers(
  updatedAtStart: string, updatedAtEnd: string, maxPages = 20,
  client: Tier0Client = createClient(),
) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('无效页数上限');
  for (let page = 1; page <= maxPages; page++) {
    const result = await client.members.listWorkspace({ page, size: 100, updatedAtStart, updatedAtEnd });
    yield result.list;
    if (BigInt(result.page) * BigInt(result.size) >= BigInt(result.total)) return;
    if (!result.list.length) throw new Error('分页结果与总数不一致');
  }
  throw new Error('达到同步页数上限，结果未完整');
}
```

增量时间包含边界，按 userId/updatedAt 去重，成功完成后再保存水位；跨页没有固定快照保证。只向界面返回实际需要字段。

v1 project-members 不迁移：v2 没有 getCurrentProjectId 或项目成员接口。Workspace 列表只用于 Workspace 级选择，不能冒充某 App 的可访问用户；需要 App 可用成员时用 `members.listApp`（见 [App 可用成员](app-members.md)）。无权限时报告配置问题，不以用户手填 ID 绕过。
