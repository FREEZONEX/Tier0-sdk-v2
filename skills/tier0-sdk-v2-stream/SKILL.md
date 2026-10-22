---
name: tier0-sdk-v2-stream
description: 使用 @tier0/sdk-v2 的 client.stream 管理 Tier0 Stream 程序和原生文档，配置源绑定，执行校验、样例测试、部署、停用、回滚和运行观测。
---

# Stream 处理与运行

Stream 负责处理逻辑和运行。连接凭据由 [Source](../tier0-sdk-v2-source/SKILL.md) 管理，集合和记录由 [UNS](../tier0-sdk-v2-uns/SKILL.md) 管理。应用集成使用 `client.stream`，不再用旧 Flow 或 `client.uns.stream*`。

## 先区分两个契约

| 形态 | 数据与入口 |
| --- | --- |
| Runtime program | `{ sdkVersion: 'tier0-stream/v2', name, script, sourceBindings?, timeoutMs? }`；使用 `stream.programs.*` |
| 云端原生文档 | `{ name, model, script, sources?, entries? }`；使用 `stream.documents.*` |

两个 script 字段的形态可能不同，不能直接相互拷贝。Runtime script 是完整 `module.exports = api => { ... }` 程序，不能只写一个 transform 函数体。脚本里的 `api.source/api.uns/api.stream` 属于平台执行器，不是本 npm 包的 `client`，不要在运行时脚本内套用 HTTP SDK 示例。

## 发现和读取

```ts
import { createClient } from '@tier0/sdk-v2';

export async function inspectStreams() {
  const client = createClient();
  const capabilities = await client.stream.runtime.capabilities({});
  const programs = await client.stream.programs.list({ page: 1, size: 20 });
  return { capabilities: capabilities.data, programs: programs.data };
}
export async function inspectRun(id: string) {
  const client = createClient();
  const observation = await client.stream.observations.get({ id });
  const runs = await client.stream.runs.list({ id, size: 20 });
  return { observation: observation.data, runs: runs.data };
}
```

优先读取当前文档和 runtime capabilities。按真实 ID 查询；原生 ID 保持十进制字符串。读取旧运行结果不能证明最新 release 已生效。

## 校验 Runtime program

```ts
import { createClient } from '@tier0/sdk-v2';

export async function validateHealthProgram() {
  const client = createClient();
  return client.stream.programs.validate({
    document: {
      name: 'Health response',
      sdkVersion: 'tier0-stream/v2',
      script: 'module.exports = api => { api.stream.onRequest({ id: "health" }, () => ({ ok: true })); };',
      timeoutMs: 1000,
    },
  });
}
```

这是无外部连接的校验示例，尚未创建或部署。业务程序应按能力目录填写真实入口与绑定。Runtime `sourceBindings` 使用 sourceId、configRevision、acquisition；连接地址、认证、TLS 从 Source 读取，不复制到 acquisition 或脚本。原生文档的 sources 按其自身契约填写。

## 创建、更新、发布

- `programs.create/update` 保存程序，先 `validate` 或 `dryRun: true` 检查；不能把保存成功当成发布成功。
- `programs.deploy` 执行发布；`programs.disable` 停用；`programs.rollback` 回到明确的 versionId。版本先从 `programs.versions.list({ id })` 查询。
- 更新、部署与回滚携带读取到的 expectedRevision；涉及 Source 修订约束时携带 expectedSourceRevision。不要把名字、当前时间或版本序号猜成 ID。
- 原生文档用 `documents.validate/create/update`，原生停用用 `documents.disable`，它要求 expectedRevision 和 expectedActiveRelease。不要给原生文档虚构 `documents.deploy`；按其实际发布语义及回执判断生效。
- 用户仅要求检查/修正脚本时，不附带执行部署或停用。

调用结构见 [生命周期示例](references/lifecycle.md)。

## 样例测试与运行对账

`sampleTest({ document, entryId, input })` 接收原生文档，返回 isolated-sample 的 status、writePreview、logs 等。HTTP 成功时也要检查 `data.status` 与 `data.errorCode`；预览写入不是实际写入，样例成功不证明线上依赖可用。

Source/Stream 返回完整 `{ code, msg, requestId, data }`，错误使用 `UnsV2Error`。部署超时或 `UnsV2OutcomeUnknownError` 时查询程序/观测/运行记录，保留原意图键；不自动再次 deploy 或换新 key。分页使用 runs 返回的 cursor，执行结果与运行状态按服务端值呈现。
