# 协议与能力

通过 `client.source.protocols.list({})` 获取执行目标的协议、配置与凭据 schema。已有当前目录可复用。共享 SourceDefinition 统一字段，不能据此假定所有目标都实现了相同驱动。

| 类型 | Source 配置与调用 |
|---|---|
| 普通 HTTP Client | protocol:http-api、role:client、endpoint、http；Stream 使用 source.request |
| OAuth Client | protocol:oauth2；公开授权配置放 http.oauth，秘密经 credentials 导入 |
| HTTP Server | protocol:http-api、role:server，托管 endpoint 按目标目录；业务路由属于 Stream |
| MQTT / OPC UA / Modbus | mqtt / opcua / modbus-tcp；连接在 Source，采集参数在 Stream acquisition |
| SQL | edge-sql；支持连接独立创建的目标可暂不配置查询，读取前声明固定 sql.query 或 sql.queries，二者互斥；脚本按已声明查询执行 |
| 厂商模板 | sourceType 与参数、凭据及资源按对应目录；原生操作保留其参数和路由语义 |

Cloud 普通 HTTP `custom` 凭据的唯一 values 键是实际认证头名；Plex 模板的 `values.apiKey` 是语义字段。两者不能互换，见[创建](create.md#自定义-http-认证头)。支持复用厂商认证的 Cloud 后端中，同一厂商 Source 可通过 source.request 调用根下业务路径，沿用原认证和参数，无需新增目录资源；Enterprise 组合以目标发现为准。

http.headers 只放公开业务头，http.parameters 放公开厂商参数。TLS/证书引用依目标 `tlsReferencesSupported` 与凭据 schema；不能用文件路径冒充资产 ID 或另一 Source 的引用。

`stateManagementSupported` 决定有无独立启停操作。Cloud Stream 消费远端 Source 时区分运行端的 `remoteStreamTarget` 与 Source 所在端的资源能力；绑定 target 使用真实节点、Source ID、configRevision。不要把 MCP 的 fleetNodeId 参数直接添加到 SDK 方法。

HTTP Server 的执行与响应见 [HTTP Server Stream](../../tier0-sdk-v2-stream/references/http-server.md)。
