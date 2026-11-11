---
name: tier0-sdk-v2-streams
description: 在 Tier0 App 服务端使用 client.streams 调用已发布的 Stream 请求，发布或订阅实时业务消息。Stream 草稿与发布管理使用 tier0-sdk-v2-stream；历史业务数据使用 Collection。
---

# App 调用 Stream

`client.streams` 用于已发布请求和实时业务消息；单数 `client.stream` 用于[管理程序与发布](../tier0-sdk-v2-stream/SKILL.md)。两者都来自 `@tier0/sdk-v2`。

在 App 服务端使用持有 Key 的客户端，浏览器调用 App 自己的服务端路由，不把平台 Key 放进前端。创建客户端与环境配置见 [根 Skill](../SKILL.md)。

## 选择请求或消息

| 需要 | SDK |
| --- | --- |
| 发现公开请求合同 | `streams.requests.discover()` |
| 查看已知请求的公开合同 | `streams.requests.use({code}).describe()` |
| 一次业务调用并取得结果 | 同一 handle 的 `invoke(input, options)` |
| 发送/订阅实时逻辑主题 | `streams.messages.use({topic}).publish/subscribe` |
| 保存或读取历史业务数据 | [Collection](../tier0-sdk-v2-uns/SKILL.md) |

已知当前合同即可调用，不需要每次 describe 或能力探针。`streams.capabilities.discover()` 描述交互能力，`client.capabilities.discover()` 描述管理能力；两者不授予权限。

App 运行 Key 可调用授权给该 App 的请求；简化合同的授权绑定当前发布入口版本，新发布不自动继承旧版本授权。Builder 在同一工作区使用当前 MCP 管理接口配置 grant；App 运行 Key 不管理 grant。现有接口为 stream-requests/grants/get、grants/set 和 app-stream-access/list，均在 `/openapi/v2/uns/` 下；不虚构 `client.uns` 的授权方法。更新 grant 使用其当前快照，冲突或结果未知先核对状态。

消息方向来自已发布 Stream 清单：App 可订阅 Stream 声明发布的主题，向活跃 Stream 声明订阅的主题发布；没有另一个逐 App topic 清单。请求、消息仍受工作区可用能力和当前凭据约束。

## 请求示例

```ts
import { createClient } from '@tier0/sdk-v2';

export async function approveOrder(orderId: string) {
  const client = createClient();
  const request = client.streams.requests.use<{orderId:string},{accepted:boolean}>({code:'orders.approve'});
  return request.invoke({orderId});
}
```

调用方使用真实已发布的 code，不从 handler ID 猜测，也不选择发布版本或宿主超时。已知合同即可调用，按其 inputSchema/outputSchema 构造业务 JSON；TypeScript 泛型不替代服务端验证。简化合同省略 sideEffect/idempotency，其他公开元数据仍由平台返回。成功回执含 result、runID、status:'completed'、replayed。

普通请求可直接 `invoke(input)`，每次调用独立，平台不自动重跑 handler。可选 `{idempotencyKey}` 仅对同次请求做传输去重，明确重传时保持键和输入不变；业务幂等、重试和补偿由业务代码处理。历史发布仍按原合同执行，包括原先要求的键。SDK 不生成调用键、不自动重试。`StreamRequestResultUnknownError` 表示执行可能发生，先核对 runID/runStatus 等证据；不能换键假定业务未执行。`execution:'notStarted'` 只在明确未派发时提供。

## 实时消息示例

```ts
import { createClient, type StreamMessageError } from '@tier0/sdk-v2';

export async function watchOrders(
  receive: (payload:{orderId:string}) => void,
  reportError: (error:StreamMessageError) => void,
) {
  const client = createClient();
  const removeErrorHandler = client.streams.messages.onError(reportError);
  const subscription = await client.streams.messages.use<{orderId:string}>({topic:'orders/accepted'})
    .subscribe(message => receive(message.payload));
  return async () => {
    await subscription.dispose();
    removeErrorHandler();
    await client.dispose();
  };
}
```

实时消息没有历史保留、离线队列或重放。publish 成功仅表示 broker flush，不代表接收方业务提交；断线后发布失败，重连恢复订阅但不重发消息。为异步连接、解码和 handler 失败注册 onError，服务退出时释放订阅及自有客户端。

消息封装为 `{version,messageId,correlationId?,payload}`；payload 内自报身份只是业务数据。SDK 管理连接票据和 broker 身份，应用只配置逻辑 topic 与 payload。消息功能需要 Node.js 22+，仅 HTTP 功能支持 Node.js 20.19+。

## Stream 端对应入口

支持简化请求合同的后端只需 ID 与 handler，超时沿用程序的 script.timeoutMs，无需业务 sideEffect、idempotency、schema 或版本声明：

```js
module.exports = api => {
  api.stream.onRequest({id:"echo"}, async ctx => ctx.input);
};
```

业务输入校验、普通调用错误的 catch、重试和补偿写在 handler；权限、凭据、资源与执行限额拒绝仍由平台终止。onTimer 另需 intervalMs，Source onMessage 另需 source/resourceRefs 及采集参数，HTTP 入站 onRequest 另需 source/method/path。业务消息订阅为 `api.stream.messages.subscribe({id,topic,inputSchema},handler)`；发布先声明 `api.stream.messages.use({topic,access:'publish'})`，再调用 `api.stream.messages.publish({topic,payload})`。`api.stream.onMessage` 接收 Source 事件，不是业务消息订阅。

Stream 返回结果不会自动写 Collection。发布与执行能力以目标当前合同为准，HTTP 请求和厂商认证边界见 [Stream 管理](../tier0-sdk-v2-stream/SKILL.md#按需请求与-http)。
