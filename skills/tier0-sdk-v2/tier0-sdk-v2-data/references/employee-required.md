# 员工请求必须携带身份

仅允许员工发起的服务端业务入口可用 `runWithRequiredEmployeeContext`，在员工断言缺失或格式错误时，在运行 handler 之前失败；不要捕获错误后改用 App 身份重试。

```typescript
import { runWithRequiredEmployeeContext } from '@tier0/sdk-v2/data';

export function handleEmployeeRequest(request: Request, next: () => Promise<Response>): Promise<Response> {
  return runWithRequiredEmployeeContext(request, next);
}
```

SDK 只检查格式，不验证签名、Workspace、成员资格或资源权限；请求必须来自可信 App Gateway，Gateway 和 UNS 仍需验证断言及当前权限。不要将浏览器自行提供的头作为可信身份。`ensure` 和 seed 仍以 App 身份执行；只有明确授权的后台工作才使用 `runAsApp`。旧的 `runWithRequestContext` 保持可选断言行为，此新入口必须由应用显式接入。

此入口不启用动态 Key provider，也不证明不同 Key 的幂等回执可以共享。Key 或主体改变时不能假设未决写入可以安全重放。
