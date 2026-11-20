# 数据请求观察

排查请求等待和重试时，可在现有客户端配置可选 `onRequest`，不必包装 fetch 或记录业务正文：

```ts
import { createDataClient, type DataRequestObservation } from '@tier0/sdk-v2/data';

function recordRequest(event: Readonly<DataRequestObservation>) {
  console.info(event);
}

const data = createDataClient({ onRequest: recordRequest });
```

每个数据层 UNS 调用结束通知一次，包括 bootstrap/ensure，多个游标页各自通知；订阅流不在此入口。事件含 operation、单集合调用的 collectionId、最近一次 UNS 响应的 requestId、outcome、可用时的 errorCode，以及：

- `queueMs`：本进程数据请求槽位等待总时间。
- `requestMs`：所有 UNS 尝试总时间，包含编码、传输、解析和底层代理恢复；不是 SQL 执行时间。
- `durationMs`：整个调用时间，包含排队、尝试和数据层重试退避。
- `attempts/retries`：UNS 客户端尝试及数据层重试次数，不是底层代理 HTTP 次数；排队放弃或请求体被本地拒绝时未发出尝试。

UNS 批量响应本身成功时 `outcome` 为 success，即使某个子项失败；仍需处理 queryBatch 的逐项结果。集合方法的本地 schema 校验不经过 UNS，因而不会产生此事件。失败请求可能没有 requestId。

事件不包含正文、过滤条件、凭据、幂等键或错误详情。回调默认关闭，异步回调不会被等待，回调抛错/拒绝不会改变查询或写入结果。保持回调轻量；不要在回调中无条件调用同一个 data 客户端形成递归。

使用 requestId 关联后端执行计划或日志；数据库连接等待/执行耗时需要后端证据，不能从 requestMs 直接推算。该入口不新建自动采集任务，也不修改 App 的重试、授权或查询策略。
