---
name: tier0-sdk-v2-members
description: 使用 @tier0/sdk-v2 查询 Tier0 Workspace 成员、搜索用户和解析通知收件人，并按 appId 查询能使用某个 App 的成员；区分 Workspace 身份与 App 访问授权。
---

# Workspace 成员查询

参数表、成员选择和有界增量分页见 [Workspace 成员](references/platform-members.md)。v1 的项目成员接口未迁入 v2，不能用 Workspace 列表代替 App 授权名单。

公开入口有两个：`client.members.listWorkspace` 只用于 Workspace 级的成员选择；需要能使用某个 App 的成员时用 `client.members.listApp`。没有 project 成员迁移别名，也不在客户端推断 App 成员。使用服务端 API Key；平台授权决定可查询范围。

## 搜索与展示候选人

```ts
import { createClient } from '@tier0/sdk-v2';

export async function searchMembers(keyword: string, page = 1) {
  const result = await createClient().members.listWorkspace({
    keyword, statuses: ['active'], page, size: 20,
  });
  return {
    list: result.list.map(member => ({
      userId: member.userId,
      label: member.nickName || member.userName || member.email || '未命名成员',
      email: member.email,
      status: member.status,
      roles: member.roles,
    })),
    total: result.total, page: result.page, size: result.size,
  };
}
```

返回值已解包，不读 result.data。userId 始终作为字符串传给通知或业务表；不要转换成 Number。名称不唯一，用户意图不能唯一定位时返回候选人，不能静默选第一个。

## 筛选与分页

请求可带 keyword、page、size、roleKey、roles、statuses、updatedAtStart、updatedAtEnd。角色与状态取自实际平台定义，不造枚举或假定固定管理员角色。时间字段为字符串，按服务端认可格式使用；不要将 number 毫秒直接填进去。

返回 list/total/page/size；total/page/size 可能为 number 或 bigint。批量同步按服务端返回分页继续，并限定本次任务的范围，不把一页或受限视图宣称为完整目录。按更新时间增量同步时保存已确认的水位并处理边界重复。

## 用于通知

1. 确定查询的是当前 Workspace，按姓名/邮箱等输入取得候选人。
2. 使用选定的 userId 调用通知，展示名只用于 UI。
3. 需要“这个 App 的所有用户”时用 `listApp` 取访问名单，不能直接遍历 Workspace 成员群发。

[通知 Skill](../tier0-sdk-v2-notifications/SKILL.md)说明渠道与幂等。成员查询不会替你建立 App 访问权限，也不能证明收件人可以打开通知里的业务页面。

## App 可用成员

能使用某个 App 的成员用 `members.listApp`，参数、示例与错误处理见 [App 可用成员](references/app-members.md)。`appId` 必须显式传入，SDK 不隐式读取 `APP_ID`；查询当前 App 时传 `getCurrentAppId()`。3003016 / 3003017 都是 HTTP 503，表示访问名单暂时无法给出，不是空名单：按 `ApiError.code` 分支，不匹配 message 文本；3003016 需要重新部署 App，3003017 可稍后重试。

## 当前边界

whoami 是 Key 身份查询，不是成员列表；它也不是浏览器当前员工身份。401/403 应核对 Workspace 和权限，不自动切换到更高权限凭证。只回传界面实际需要的成员字段，避免把整个目录和角色数据泄露给无关调用方。
