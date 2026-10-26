---
name: tier0-sdk-v2-agent
description: 使用 @tier0/sdk-v2 的 client.agent 查询和管理 Agent 作业、运行记录、分析、结果、卡片、资料库与关系，处理调度副作用和并发编辑。
---

# Agent 作业与结果

Agent 是平台应用能力，区别于 Stream 数据处理程序。使用服务端 client.agent；本领域平台 v2 响应已解包，直接读取 list/job/run/result 等字段。

## 入口选择

| 入口 | 方法与用途 |
| --- | --- |
| jobs | list/get/create/update/pause/resume/trigger/delete，管理任务与调度 |
| jobRuns | list/get，查看具体执行 |
| analyses | dispatch/get，分发分析和读取结果 |
| results | create/get/list/pin，保存分析产物并固定到画布 |
| cards | list/get/update/delete，操作画布卡片 |
| canvases | list，查找画布 |
| library | list/get/create/update/delete，复用卡片定义 |

dispatch、trigger 都有副作用，不能在普通查询流程中悄悄执行。

## 查询作业与运行

```ts
import { createClient } from '@tier0/sdk-v2';

export async function listJobs(page = 1) {
  return createClient().agent.jobs.list({ page, size: 20 });
}
export async function inspectJob(jobId: string) {
  const client = createClient();
  const job = await client.agent.jobs.get({ jobId });
  const runs = await client.agent.jobRuns.list({ jobId, page: 1, size: 20 });
  return { job: job.job, runs: runs.list, total: runs.total };
}
export async function inspectJobRun(jobId: string, jobRunId: string) {
  const response = await createClient().agent.jobRuns.get({ jobId, jobRunId });
  return response.run;
}
```

作业 ID 与运行 ID 不同；不能拿 resultId 去查 jobRuns。分页接口一般要求 page/size，按返回 total/list 继续。status/dispatchState 按服务端值处理，收到派发回执不等于作业完成。

## 创建与调度

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type CreateJob = Parameters<Tier0Client['agent']['jobs']['create']>[0];
export async function createConfiguredJob(input: CreateJob) {
  // input 的调度和 task 内容来自当前平台认可的业务配置。
  return createClient().agent.jobs.create(input);
}
export async function triggerExistingJob(jobId: string) {
  return createClient().agent.jobs.trigger({ jobId });
}
```

创建必填 name/scheduleKind/task/sourceType/sessionId。scheduleKind 的可用值、task 对象和时间单位须来自实际业务契约，Swagger 中的 string/unknown 不意味着可以任意填写。pause/resume/trigger 是不同意图；不要用“暂停后再恢复”来替代查询。

jobs.update 的 notifyEnabled：省略保留原通知，1 要求提供 notify，2 关闭通知且不带 notify。没有通用作业幂等键字段时，不得额外塞 idempotencyKey；不确定的 trigger 先查运行列表对账。

## 保存结果与并发编辑

result.create 的 operationId 由调用方持有；保存超时后可用 `results.get({ operationId })` 查回，不能再创建新 operationId 重复保存。get 按 resultId 或 operationId 二选一。

cards.update 要带读取时的完整 expectedCardSpec；library.update 要带完整 expectedItem 快照。409 表示内容已变化，应重新读取并合并用户意图，不能自动覆盖。具体示例见 [结果与卡片编辑](references/results.md)。

结果附件/图片使用 [文件 Skill](../tier0-sdk-v2-files/SKILL.md) 的持久化 filePath，不保存签名 URL 作为长期资源。失败保留 ApiError.status/code/errorCode；写入 outcomeUnknown 时先查询对应资源，不自动重发。

旧 Namespace 节点的语义索引和 path 关系接口未纳入 v2，不再提供 nodes/relations 方法。
