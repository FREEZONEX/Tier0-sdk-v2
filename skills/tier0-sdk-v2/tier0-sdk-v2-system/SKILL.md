---
name: tier0-sdk-v2-system
description: 使用 @tier0/sdk-v2 查询 Tier0 凭证身份、平台版本、MQTT Broker 与能力就绪状态，区分身份、授权、发布开关和实际可用性。
---

# 系统与能力发现

| 任务 | 参考 |
| --- | --- |
| 诊断 Key 所属 Workspace 和权限 | [whoami](references/whoami.md) |
| 查看平台版本、解析 Broker 地址 | [info](references/info.md) |

使用服务端 `createClient()` 或显式传入 apiHost/apiKey。系统排查从只读信息开始，不因功能不可用自动创建 Key、修改权限或部署服务。

## 最小诊断

```ts
import { createClient } from '@tier0/sdk-v2';

export async function diagnose() {
  const client = createClient();
  const identity = await client.system.whoami();
  const info = await client.system.info();
  const discovery = await client.capabilities.discover();
  return {
    workspaceId: String(identity.workspaceID),
    keyType: identity.keyType,
    platformVersion: info.version,
    capabilities: discovery.capabilities.map(item => ({
      code: item.code, state: item.state, allowed: item.allowed,
      availability: item.availability,
    })),
  };
}
```

whoami 返回 Key 关联的主体与 Workspace，包括 userID、workspaceID、permissions、roles、keyType；它不是当前浏览器员工的身份证明。不要将关联 userID 当作 App 请求的当前访问者。

info 返回 name/version/mqttBroker/capabilities，字段可能省略。MQTT broker 地址先用 `toWebSocketUrl` 转换，详见 [MQTT](../tier0-sdk-v2-mq/SKILL.md)。info 中的 capabilities 字符串列表不替代完整能力发现。

## 读懂能力结果

| 字段/状态 | 判断 |
| --- | --- |
| releaseEnabled | 平台/Workspace 发布开关，不代表运行时已准备好 |
| allowed | 当前身份的授权摘要，不是某个具体操作的执行许可 |
| enabled、state=ready | 服务端评估就绪 |
| availability=available | 能力可用性，不是设备在线、业务执行或 ACK |
| disabled / not_supported / unavailable | 展示具体不可用原因，不强制调用 |
| readiness_unknown | 保留未知状态，不能按成功处理 |

本数据 SDK 的能力目录识别 namespace.v2、source、stream；其他 SDK 的可选交互能力按各自合同处理，不阻断 Namespace 发现。Source/Stream 的 contractVersions 使用 openapi/v2，不要求或返回解释器版本。contractVersions、apiContractVersions、sdkContractVersions 是契约标签，不是 npm 包版本；productVersion 未配置时可缺省。顶层要求受支持的核心 OpenAPI v2 合同，已识别能力也必须满足其合同；不要求全局交互 SDK 标签，不把未知能力投影为已支持。

## 定位问题

- 401/403：核对目标 Host、Key 对应 Workspace 和所需权限；不输出完整 Key。
- 方法存在但能力关闭：记录 code/state/availability，检查该环境的部署与配置，不能凭本地生成文件推断线上已支持。
- `CapabilityError`：保留 status/errorCode；不支持的契约版本与错误响应格式需要排查服务端/SDK 配套版本。
- 系统普通 API 使用 `ApiError`，HTTP 200 的业务失败仍会抛错。
- 仅上报排查需要的字段；whoami 中的邮箱、角色和 Key 前缀不应无差别返回给浏览器。

需要 Source/Stream 运行健康信息时，进一步使用对应领域的 observations/runs；系统能力就绪只说明可以进入该领域流程。
