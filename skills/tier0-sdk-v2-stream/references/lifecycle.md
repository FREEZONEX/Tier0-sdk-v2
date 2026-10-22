# Stream 生命周期调用

## 保存、部署、版本

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type Program = Parameters<Tier0Client['stream']['programs']['create']>[0]['document'];
type Revision = NonNullable<Parameters<Tier0Client['stream']['programs']['deploy']>[0]['expectedRevision']>;
export async function previewProgram(document: Program) {
  return createClient().stream.programs.create({ dryRun: true, document });
}
export async function previewDeploy(id: string, expectedRevision: Revision) {
  return createClient().stream.programs.deploy({ id, expectedRevision, dryRun: true });
}
export async function listVersions(id: string) {
  return createClient().stream.programs.versions.list({ id, page: 1, size: 20 });
}
export async function previewRollback(id: string, versionId: string, expectedRevision: Revision) {
  return createClient().stream.programs.rollback({
    id, versionId, expectedRevision, dryRun: true,
  });
}
```

实际 create/deploy/rollback 需显式 dryRun=false。预览不预留资源，不保证稍后的实际提交成功。versionId 必须来自版本列表；expectedRevision 来自当前对象，expectedSourceRevision 按服务端绑定校验要求填写。程序业务 timeoutMs 与 HTTP transportTimeoutMs 是不同层次，调大后者不会重写程序运行期限。

保存、发布、停用与回滚各有独立业务意图键，不能复用一个键表达不同请求。对未知结果先核对最新配置、版本和观测，避免重复发布。

## 原生文档样例测试

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type SampleInput = Parameters<Tier0Client['stream']['sampleTest']>[0];
export async function testNativeDocument(input: SampleInput) {
  const response = await createClient().stream.sampleTest(input);
  return {
    status: response.data.status,
    errorCode: response.data.errorCode,
    writes: response.data.writePreview,
    logs: response.data.logs,
  };
}
```

input 需带真实 CloudStreamDocument、其中已定义的 entryId 和测试 input。样例模式为 isolated-sample；writePreview 只是预览，不能用它宣称实际 UNS 数据已更新。不得把输出日志中可能存在的业务敏感值直接公开。

原生停用必须传当前 expectedRevision 与 expectedActiveRelease，避免停掉别人刚发布的新版本。程序入口与原生入口并存是底层契约差异，不应通过强制类型转换混用 document。

## 运行观察

stream.observations.get({ id }) 查观测，stream.runs.list({ id, size, cursor }) 查运行。显示实际 release/修订与错误，区分“草稿已保存”“发布已确认”“某次运行完成”。源连接失败时转 Source 检查，不以重新部署 Stream 代替根因排查。
