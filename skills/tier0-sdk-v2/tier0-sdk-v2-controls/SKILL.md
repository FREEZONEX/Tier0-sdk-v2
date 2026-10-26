---
name: tier0-sdk-v2-controls
description: 使用 @tier0/sdk-v2 发现、描述和调用 Tier0 Control 业务契约，区分读写副作用、契约版本、幂等要求和执行结果未知。
---

# Control 契约调用

Control 是已发布的业务调用入口；它可由 Stream 提供，但调用方不选择内部 streamId、entryId 或部署版本。使用服务端 client.controls，实际调用 `/openapi/v2/uns/controls/discover|describe|invoke`，不重建旧 Flow 调用。

## 发现和读取契约

```ts
import { createClient } from '@tier0/sdk-v2';

export async function discoverControls(search: string) {
  return createClient().controls.discover({ search, page: 1, size: 20 });
}
export async function describeControl(code: string) {
  return createClient().controls.use({ code }).describe();
}
```

discover 返回 total/list，分页从 1 开始，size 为 1–200。code 取自发现结果，不由显示名称猜测。describe 返回 inputSchema、outputSchema、sideEffect、idempotency、contractVersion、timeoutMs 和 status。

## 构造调用

1. 依据 inputSchema 填写输入，业务 JSON 不等于任意控制参数。SDK 的泛型只提供静态提示，不能替代契约校验。
2. 判断 sideEffect=read/write，与用户本次任务的授权范围一致。
3. 当 idempotency=required 时提供稳定的业务意图键；optional/none 按契约决定，不自动生成 UUID 重试。
4. 调用后检查业务 result 与 status，记录 runID/contractVersion，不能只看请求未抛错。

```ts
import {
  createClient, ControlResultUnknownError, type ControlJSON,
} from '@tier0/sdk-v2';

export async function invokePreparedControl(code: string, input: ControlJSON, intentKey?: string) {
  const handle = createClient().controls.use({ code });
  const definition = await handle.describe();
  if (definition.idempotency === 'required' && !intentKey) {
    throw new Error('该 Control 要求业务幂等键');
  }
  // 调用方已经按 definition.inputSchema 校验输入，并确认本次业务意图。
  try {
    return await handle.invoke(input, intentKey ? { idempotencyKey: intentKey } : {});
  } catch (error) {
    if (error instanceof ControlResultUnknownError) {
      return { outcomeUnknown: true as const, runID: error.runID, errorCode: error.errorCode };
    }
    throw error;
  }
}
```

幂等键非空、不能有首尾空白，最多 128 UTF-8 字节。输入使用 JSON；需要保留精确数字时可用 UnsV2RawNumber，不传 Date、函数、循环对象、bigint、NaN/Infinity。业务 input 内名为 timeoutMs/streamId 的字段仍只是业务输入；不能借它覆盖服务端绑定、版本或执行超时。

## 返回与失败

成功值为直接对象：code（Control 标识）、contractVersion、result、runID、status、replayed。这里的 code 不是 HTTP 业务状态码；replayed 只有服务端明确报告重放时才为 true。

`ControlError` 含 status/errorCode/runID 与 requestId/execution/retry 等信息，SDK 不自动重试。`ControlResultUnknownError` 表示执行可能已经发生，包括调用响应无法证明最终结果的情况；按业务或平台运行记录对账。本 SDK 未提供通用 `controls.getRun`，不要虚构方法。若业务明确允许重放，保留原 key 和原输入，不能换新 key 重做。

`client.capabilities.discover()` 的 control.invoke.v1 就绪只是入口条件，不等于有权调用每一个 Control。执行源发布和内部绑定管理请使用 [Stream Skill](../tier0-sdk-v2-stream/SKILL.md)。
