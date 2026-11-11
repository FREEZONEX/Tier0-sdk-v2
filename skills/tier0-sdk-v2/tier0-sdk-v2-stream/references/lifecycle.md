# 样例测试与业务验收

创建/修改回执可直接用于发布；发布回执用于观察该 release 的运行。只执行任务需要的生命周期步骤，已有当前快照无需在每步前后 get。

## 隔离样例

`stream.sampleTest` 使用完整 document、该文档注册的 entryId 和样例 input。它检验映射行为，writePreview 不写线上数据。

```ts
import { createClient, type Tier0Client, type CloudStreamDocument, type UnsV2JSONValue } from '@tier0/sdk-v2';

export async function testStreamSample(
  document: CloudStreamDocument, entryId: string, input: UnsV2JSONValue,
  client: Tier0Client = createClient(),
) {
  return client.stream.sampleTest({document,entryId,input});
}
```

检查结果 status 为 completed/failed 以及 errorCode，不能仅看 HTTP 成功。样例日志可能包含业务数据；样例成功不证明线上 Source 可达或提交成功。

## 按任务验收

| 任务 | 需要确认 |
| --- | --- |
| 周期采集 | timer 真实触发，本次 release/entryId 运行完成 |
| 持续订阅 | 对应 Source/资源有真实输入，入口完成业务提交 |
| 请求返回 | 调用完成及返回值符合合同 |
| Collection 落库 | 上述运行证据加按业务键读回 Record/Sample |
| 消息发布 | 与业务提交分开检查消息发布回执 |

`return response.data` 不会落库；`write` 返回 buffered 也不是提交完成。缺少输入时报告等待条件，读回失败时保留已确认的运行结果。失败或 unknown 的旧任务不因新脚本自动安全重跑，见 [运行诊断](read.md)。
