# 本地连接与排错

个人 Key 可用于本地脚本、数据分析和调试。SDK 与 MCP 是两种调用入口；MCP 已连接不代表本地 SDK 已配置地址或凭证。读取已有普通 collection 不要求创建或部署平台 App，也不需要 App ID。实际访问范围由个人 Key 及其所属用户的权限决定。

## 确定 API 地址

`apiHost` / `TIER0_API_HOST` 填写当前环境的 **OpenAPI 网关基础地址**，不附加 `/openapi/v2`、页面路径或 Workspace ID；SDK 自动添加接口路径。平台网页地址、MCP 地址与网关地址不能互换。

| 已知平台环境 | OpenAPI 网关基础地址 |
| --- | --- |
| 阿里云 ACK 开发环境 `https://dev.tier0.cn` | `https://api-dev.tier0.cn` |

其他环境或私有化部署：从该环境的部署/接入指南取得 OpenAPI 公网入口；若指南未提供，向环境管理员确认“对本机可达、暴露 `/openapi/v2` 的网关基础地址”。不要靠网页域名拼接或猜测地址。若没有对外暴露网关，需由管理员提供入口或网络接入方式，SDK 无法补齐部署。

私有化地址通过 `apiHost` 或环境变量显式配置，支持已有的基础路径前缀。本地 HTTP 网关需写明 `http://`，裸域名默认 HTTPS。SDK 不从 Key 推断地址，不探测候选域名、不自动切换 Host，也不跟随 API 重定向传递密钥。

## 个人 Key 读取已有集合

安装 SDK，使用 Node.js 20.19+。在本机创建 `.env.local`，将它加入 `.gitignore`，填入已经确认的网关、个人 Key 和 collection ID。密钥只留在本地受控配置或服务端，不写进代码、浏览器变量、日志或提交记录。

```dotenv
TIER0_API_HOST=https://api-dev.tier0.cn
TIER0_API_KEY=填入该环境的个人Key
TIER0_COLLECTION_ID=填入已有collection的ID
```

将以下代码保存为 `read-records.mjs`。`whoami` 用于首次确认连接身份及 Workspace；后续业务查询不必每次调用。先核对输出的 Workspace 与目标集合一致。

```ts
import { createClient } from '@tier0/sdk-v2';

const collectionId = process.env.TIER0_COLLECTION_ID;
if (!collectionId) throw new Error('请设置 TIER0_COLLECTION_ID');
const client = createClient();
const identity = await client.system.whoami();
console.log('Workspace:', identity.workspaceID);
const result = await client.uns.recordFind({ collectionId, limit: 20 });
console.dir(result.data, { depth: null });
```

```sh
node --env-file=.env.local read-records.mjs
```

示例只读第一页，后续按 `pageInfo` 分页；不会创建集合、修改 Schema 或写入种子数据。collection 由 MCP、页面或其他应用创建不影响此调用方式，知道 ID 不代表取得权限。长期团队应用使用独立 App 身份，避免依赖某个员工的个人 Key。

## 按响应排错

| 响应或错误 | 下一步 |
| --- | --- |
| HTML / 非 JSON 404、405 | 核对网关基础地址及 `/openapi/v2` 路由；不要先更换 Key。网页域名可能只提供前端页面。 |
| 401 | 先确认目标网关，再检查 Key 是否提供、是否有效、是否属于该环境；网关前的代理也可能要求认证。 |
| 403 | 检查当前凭证的资源/操作权限与网关访问限制；不等同于 Key 无效。 |
| 502、503、504 | 检查网关和上游服务健康；重发写入前确认执行结果，避免重复写入。 |
| 200 但返回 HTML / `SDK_PROTOCOL` | 核对网关地址、代理转发及响应格式；页面可打开不代表 OpenAPI 可用。 |
| 网络错误或超时 | 检查 DNS、网络接入、TLS 和服务连通性；不能仅据此判断凭证无效。 |
| 正常 JSON 业务错误 | 按服务端错误码、权限信息和请求 ID 排查；JSON 404 也可能表示业务资源不存在。 |

无密钥请求返回 401 只证明已到达认证入口，不能证明某个 Key 有权读取目标集合。验证顺序是确认地址、`whoami` 核对 Workspace、按 collection ID 读取。错误提示不回显 Key、配置 URL 或原始 HTML；SDK 保留原有错误类型、HTTP 状态和执行/重试语义，不自动更换凭证或重试。
