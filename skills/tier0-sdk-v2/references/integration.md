# 身份与框架集成

仅在接入服务端身份或 React/Vue 时阅读本文件。基本分域调用见入口 Skill。

## 网关身份验签

使用服务端入口，公钥与期望 appID/workspaceID 来自固定服务端配置，不能从请求的 JWK/URL 取钥。保留原始请求字节与路径+query；JSON 解析、重编码或路径归一化后再验签会破坏绑定。

```ts
import {
  createCloudAppRequestVerifier,
  type CloudAppIdentityAuthority,
  type CloudAppIdentityRequest,
} from '@tier0/sdk-v2/server';

export function authenticateRequest(authority: CloudAppIdentityAuthority, request: CloudAppIdentityRequest) {
  const verify = createCloudAppRequestVerifier(authority);
  return verify(request);
}
```

输入 assertion 对应平台约定的 APP_REQUEST_IDENTITY_HEADER；method、requestURI、body 必须是网关签名对应的值。成功只证明该请求来源与员工身份，业务授权仍单独检查。失败拒绝当前请求，不从未验证 claims 兜底建立身份。

App 请求断言与 UNS 员工数据委托是不同的 audience。只有受信接入层获得真实 App-Data-Subject 后，才能为本次请求创建客户端：

```ts
import { createClient } from '@tier0/sdk-v2';

export function clientForTrustedGatewayRequest(apiHost: string, apiKey: string, trustedDataSubject: string) {
  return createClient({ apiHost, apiKey, unsV2AppDataSubject: trustedDataSubject });
}
```

SDK 仅检查委托的紧凑格式，不自行信任/验证其 claims。不要直接转发公开入口任意同名 header，部署边界必须保证它来自可信网关。不要跨员工复用这个实例或令牌。

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

本 SDK 验签契约沿用已记录的上游 App 网关契约，须与目标环境实际注入的 header/公钥/受众对照。契约生成、类型与本地测试证明包内部一致，不替代环境联调。确认身份、权限与字段返回后再切换真实业务流量。
