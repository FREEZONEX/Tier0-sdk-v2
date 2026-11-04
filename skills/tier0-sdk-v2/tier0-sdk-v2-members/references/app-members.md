# App 可用成员

方法：`members.listApp(body)`；POST /openapi/v2/apps/access-members/list。

> Tier0 App 里经节点代理可用，和 `listWorkspace` 同一套规则：App 的平台权限里要有 `platform.users.read`，没有时回 403（报告配置问题，不改用 Workspace 成员列表代替）；托管 App Key 拿到的是最小目录，`email` 为空字符串，展示用 `userName`。

返回能使用该 App 的有效成员：在 Builder 预览里按当前草稿的角色计算（从没发布过的 App 也一样），部署后按线上版本计算。口径由请求的 `scope` 决定，SDK 按平台注入的 `TIER0_RUNTIME` 自动带上（`preview` → `draft`，`deployed` → `production`）；App 代码不要传 `scope`，也不要在 `.env` 或 `artifact.toml` 里设置 `TIER0_RUNTIME`。`appId` 必填且由调用方显式传入，SDK 不隐式读取 `APP_ID`；查询当前 App 时传 `getCurrentAppId()`。接口只接受 API Key，登录会话不能调用；绑定 App 的凭证只能查自己的 appId，查其他 App 返回 403。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| appId | string | 必填，agent-platform App UUID |
| roleKeys | string[] | 任一命中即可，大小写不敏感 |
| grantedAtStart / grantedAtEnd | number / bigint | 授权时间，Unix 毫秒，闭区间，精度为秒 |
| page / size | number / bigint | 分页 |
| scope | string | 由 SDK 按运行环境自动带上，App 代码不传 |

```ts
import { ApiError, createClient, getCurrentAppId, type Tier0Client } from '@tier0/sdk-v2';

/** 线上版本的角色事实未落库：重试无效，需要重新部署 App。 */
const APP_ACCESS_LIST_UNDETERMINED = 3003016;
/** 成员有效状态暂时取不到：稍后重试。 */
const APP_ACCESS_LIST_UNAVAILABLE = 3003017;

export async function appMembers(page = 1, client: Tier0Client = createClient(), appId = getCurrentAppId()) {
  try {
    const result = await client.members.listApp({ appId, page, size: 20 });
    return {
      list: result.list.map(member => ({
        userId: member.userId,
        label: member.userName || member.email || '未命名成员',
        roles: member.roles.map(role => role.roleName),
      })),
      total: result.total, page: result.page, size: result.size,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === APP_ACCESS_LIST_UNDETERMINED) throw new Error('App 访问名单无法确定，请重新部署 App');
    if (error instanceof ApiError && error.code === APP_ACCESS_LIST_UNAVAILABLE) throw new Error('App 访问名单暂不可用，请稍后重试');
    throw error;
  }
}
```

返回已解包的 appId、published（1 已发布 / 2 未发布）、allActiveMembers（1 所有有效成员都可使用 / 2 按角色授权）、roles、list、total、page、size。成员的 roles[].sources 区分直接授予（direct）和经成员组授予（group）。userId 保持字符串。

3003016 / 3003017 都是 HTTP 503：访问名单暂时无法给出，不是空名单，也不代表所有人可用。按 `ApiError.code` 分支，不匹配 message 文本。3003016 是线上版本角色事实未落库，重试无效，需要重新部署 App；3003017 是成员有效状态暂时取不到，可稍后重试。无权限（403）时报告配置问题，不改用 Workspace 成员列表代替。
