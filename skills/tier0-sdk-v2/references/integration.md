# 身份与框架集成

仅在接入服务端身份或 React/Vue 时阅读本文件。基本分域调用见入口 Skill。

## 访问者身份（X-Tier0-Visitor）

平台里 App 的每个请求都经过前门：前门先剥掉客户端带来的全部 `X-Tier0-*`，再注入明文的 `X-Tier0-Visitor`（UTF-8 JSON 对象的无填充 base64url，不签名）。服务端用 `parseVisitorHeader` 解析，它严格校验字段、类型、长度，并要求 `app` 等于 `TIER0_APP_ID`：

```ts
import { parseVisitorHeader, VISITOR_HEADER, VisitorError, type Visitor } from '@tier0/sdk-v2/server';

export function visitorOf(request: Request): Visitor | null {
  try {
    return parseVisitorHeader(request.headers.get(VISITOR_HEADER));
  } catch (error) {
    if (error instanceof VisitorError && error.code === 'VISITOR_HEADER_INVALID') return null; // 回 401
    throw error; // VISITOR_CONFIGURATION_INVALID：没有 TIER0_APP_ID，回 503
  }
}
```

返回 `{ subType: 'employee' | 'machine', subject, grant, workspaceID, appID, runtime: 'deployed' | 'preview', appRoles, activeRole? }`。`appRoles` 是访问者在 App 里的角色（预览里是「以某角色查看」选中的角色），`activeRole` 只在预览的「以某角色查看」里出现，只用于展示。

App 调平台只有一种身份：App 自身（App Key，平台里由节点代理注入）。平台不按访问者收窄 App 的数据，按角色决定当前用户能看、能改哪些记录是 App 自己的事：在服务端按 `appRoles` 过滤查询条件、拒绝写入，返回给浏览器前裁掉不该看的字段。不要把访问者 ID 或角色当成平台调用的参数去「代表」用户。

## React

需要 React 与 TanStack Query、外层 QueryClientProvider。稳定持有 client；内部缓存按 client 实例隔离。含服务端 App Key 的代码不能为了使用 hook 被搬到浏览器。

```ts
import type { Tier0Client } from '@tier0/sdk-v2';
import { useTier0Query, useTier0Mutation } from '@tier0/sdk-v2/react';

export function useRecords(client: Tier0Client, collectionId: string) {
  return useTier0Query(client, ['records', collectionId], (sdk, signal) =>
    sdk.uns.recordFind({ collectionId, limit: 20 }, { signal }));
}
export function useNotification(client: Tier0Client) {
  type Message = Parameters<Tier0Client['notifications']['send']>[0];
  return useTier0Mutation(client, (sdk, body: Message) => sdk.notifications.send(body));
}
```

查询 key 包含影响结果的参数。读操作用 query，写操作用 mutation；默认不重试。实际浏览器应用若没有可安全直连平台的用户鉴权，使用自己的服务端 API 与普通框架请求库，不强行把平台 client 放入页面。

## Vue

```ts
import type { Tier0Client } from '@tier0/sdk-v2';
import { useTier0Request } from '@tier0/sdk-v2/vue';

export function useRecords(client: Tier0Client) {
  return useTier0Request(client, (sdk, collectionId: string, signal) =>
    sdk.uns.recordFind({ collectionId, limit: 20 }, { signal }));
}
```

在组件 setup 中调用，随后 execute(collectionId) 显式发起；data/error/loading 为 ref，cancel 可取消当前等待。后发请求的结果优先，scope 销毁时会取消。写操作的取消不意味着撤回服务端副作用。

## 联调证据

访问者头的字段以平台前门实际注入的 `X-Tier0-Visitor` 为准。契约生成、类型与本地测试证明包内部一致，不替代环境联调。确认身份、权限与字段返回后再切换真实业务流量。
