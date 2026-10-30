// Generated. Do not edit.
import type { UnsV2RawNumber } from '../uns-v2/codec.js';
export interface paths {
    "/openapi/v2/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** info */
        post: operations["PlatformV2Info"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/auth/whoami": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** whoami */
        post: operations["PlatformV2Whoami"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SDK文件上传申请
         * @description SDK文件上传申请
         */
        post: operations["PlatformV2AssetFileUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SDK文件下载
         * @description SDK文件下载: 返回302重定向, Location头指向最终下载地址(private为预签名URL, public为长期有效直链), 无JSON body。安全提示: 客户端跟随302时不应向跨域目标转发x-api-key等自定义凭证头(SDK侧已按此实现)
         */
        get: operations["PlatformV2AssetFileDownload"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files/url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SDK获取文件URL
         * @description SDK获取文件URL
         */
        get: operations["PlatformV2AssetFileUrl"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SDK删除文件
         * @description SDK删除文件
         */
        post: operations["PlatformV2AssetFileDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files/multipart/init": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SDK分片上传初始化
         * @description SDK分片上传初始化: 大文件(>100MB)分片直传, 服务端创建multipart任务并预占配额, 返回uploadId/partSize/partCount
         */
        post: operations["PlatformV2AssetFileMultipartInit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files/multipart/part-urls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SDK分片上传签发分片URL
         * @description SDK分片上传签发分片URL: 为指定分片签发预签名PUT URL(数据面直传对象存储), 支持断点续传
         */
        post: operations["PlatformV2AssetFileMultipartPartUrls"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files/multipart/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SDK分片上传完成
         * @description SDK分片上传完成: 服务端以ListParts真实大小做权威校验与差额补偿, temp转active
         */
        post: operations["PlatformV2AssetFileMultipartComplete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/files/multipart/abort": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * SDK分片上传中止
         * @description SDK分片上传中止: 中止multipart任务清理残留parts并释放预占配额
         */
        post: operations["PlatformV2AssetFileMultipartAbort"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/assets/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** assetUpload */
        post: operations["PlatformV2AssetUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/notifications/send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 发送消息通知
         * @description 发送消息通知：向 Key 所属 Workspace 内的用户发送站内信，并按需触发终端提醒（Web Push/移动推送）
         */
        post: operations["PlatformV2SendNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/notifications/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 查询消息通知发送状态
         * @description 查询消息通知发送状态：按 messageId 查询，归属校验锚定发起请求的 API Key
         */
        post: operations["PlatformV2GetNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/platform/getMembers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** getMembers */
        post: operations["PlatformV2GetMembers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/apps/access-members/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** listAccessMembers */
        post: operations["PlatformV2ListAccessMembers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/mqtt-auth/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建 MQTT Auth
         * @description 创建与页面手动创建类型一致的普通 MQTT Auth。OpenAPI 的 password 字段仅在本次创建成功响应中返回一次，请立即安全保存；此 OpenAPI 不提供密码查询或再次返回能力。仅 full_access API Key 可调用。
         */
        post: operations["PlatformV2Create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/mqtt-auth/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除 MQTT Auth
         * @description 幂等删除普通 MQTT Auth；不存在、已删除或非普通类型的 ID 均返回成功且不会删除 Flow、EdgeNode 等系统凭证。仅 full_access API Key 可调用。
         */
        post: operations["PlatformV2Delete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/capabilities/discover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 发现当前 Workspace 的公开能力与版本合同
         * @description 需要有效 Workspace API Key，Body 仅接受空 JSON 对象，最大 4KiB UTF-8 字节，不接受查询参数或 Workspace 覆盖。成功响应直接为 CapabilityDiscoverV2Resp，不包裹 code/msg/data。能力由默认关闭的公开发布开关、Workspace FeatureGate、Key 显式授权共同裁决；Namespace 与 Stream request 能力仅报告当前发布与授权，运行可用性保持 readiness_unknown，不触发运行时探针。Source/Stream 保留独立操作前提的证据。state=ready 不替代具体资源授权或实际运行回执。合同版本 2.0 使用 state、reasonCode、operations，不再返回重复布尔状态。实际操作由后端执行安全检查，失败返回真实错误。响应允许客户端忽略未知扩展字段；版本标签不表示设备 ACK 或 npm 包版本。错误直接返回 CapabilityErrorResp 和真实 HTTP 状态，不泄漏内部异常。
         */
        post: operations["PlatformV2CapabilityDiscoverV2"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/cards/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 读取完整画布卡片
         * @description 按已认证工作空间、画布ID和卡片行ID读取完整CardSpec，供修改前核对原卡
         */
        post: operations["PlatformV2AgentCardGet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/results/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 写入 Agent 分析结果
         * @description 沙箱 Agent 用 App key 提交结果清单 v1，按 operationId 幂等
         */
        post: operations["PlatformV2AgentResultCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/results/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 读取已保存的分析结果
         * @description 仅读取已认证工作区内的结果，resultId或operationId必须且只能提供一个；原保存编号可用于回执丢失后的只读核查，返回完整manifest与CardSpec，需要uns:read
         */
        post: operations["PlatformV2AgentResultGet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/results/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 分页查询已保存的分析结果
         * @description 按已认证工作区查询，可按平台会话过滤，page和size必填，size为1至100，需要uns:read
         */
        post: operations["PlatformV2AgentResultList"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/cards/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 更新画布卡片
         * @description 沙箱 Agent 用 App key 改画布卡片，卡片必须属于 key 所在工作空间
         */
        post: operations["PlatformV2AgentCardUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/cards/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 分页查找画布卡片
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentCardList"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/results/pin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 将已保存结果钉到画布
         * @description 仅固定已认证工作区内的结果，需要uns:write；含CardSpec时创建对应卡片，纯表图清单创建按resultId读取详情的引用卡。同结果同画布重试返回原卡，不覆盖后续修改。
         */
        post: operations["PlatformV2AgentResultPin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建业务定时任务
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentJobCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 修改业务定时任务
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentJobUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 读取业务定时任务
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentJobGet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 分页查询业务定时任务
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentJobList"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 暂停业务定时任务
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentJobPause"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 恢复业务定时任务
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentJobResume"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除业务定时任务
         * @description 仅操作已认证工作区；查询需要uns:read，写操作需要uns:write。任务负责人来自API key真实用户；创建无自动重试。
         */
        post: operations["PlatformV2AgentJobDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/job-runs/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 读取个人任务的一次运行
         * @description 仅任务负责人可用；触发返回运行编号和当前派发状态，不代表已执行成功，网络未知时禁止自动重试。
         */
        post: operations["PlatformV2AgentJobRunGet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/job-runs/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 分页读取个人任务运行历史
         * @description 仅任务负责人可用；触发返回运行编号和当前派发状态，不代表已执行成功，网络未知时禁止自动重试。
         */
        post: operations["PlatformV2AgentJobRunList"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/jobs/trigger": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 手动触发个人任务一次
         * @description 仅任务负责人可用；触发返回运行编号和当前派发状态，不代表已执行成功，网络未知时禁止自动重试。
         */
        post: operations["PlatformV2AgentJobTrigger"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/canvases/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 分页查找工作区画布
         * @description 仅列出当前工作区画布元数据，可按平台会话筛选；page、size必填，size为1至100，需要uns:read
         */
        post: operations["PlatformV2AgentCanvasList"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/library/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 分页查找卡片库
         * @description 分页查询当前工作区共享卡片模板，标签按任一匹配并可搜索标题，需要uns:read
         */
        post: operations["PlatformV2AgentLibraryList"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/library/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 读取卡片库完整原条目
         * @description 按库条目ID读取完整模板、标签和来源会话，供修改前核对，需要uns:read
         */
        post: operations["PlatformV2AgentLibraryGet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/library/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 存入卡片库，同键不同内容拒绝
         * @description 创建当前工作区模板，同cardKey相同内容复用原条目，不同内容返回409；不会覆盖旧模板，需要uns:write
         */
        post: operations["PlatformV2AgentLibraryCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/library/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 核对完整原条目后更新卡片库
         * @description 携带读取到的完整expectedItem更新模板，内容发生变化返回409；显式tags空数组清空标签，需要uns:write
         */
        post: operations["PlatformV2AgentLibraryUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/library/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除已定位的卡片库条目
         * @description 按已确认的库条目ID删除当前工作区模板，需要uns:write
         */
        post: operations["PlatformV2AgentLibraryDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/cards/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 核对原卡后删除画布卡片
         * @description 按画布和卡片行ID删除，expectedCardSpec须与当前完整原卡一致，否则返回409，需要uns:write
         */
        post: operations["PlatformV2AgentCardDelete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/analyses/dispatch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 按原操作编号派发即时分析
         * @description 以operationId UUID派发本人即时refresh或rerun分析；同编号同请求仅读回原运行，不重复执行，需要uns:write和真实负责人身份
         */
        post: operations["PlatformV2AgentAnalysisDispatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi/v2/agent/analyses/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 读取本人即时分析运行和结果定位
         * @description 按runId仅读取当前负责人在工作区内的即时分析状态、错误和结果；无权读取其他人的运行，需要uns:read
         */
        post: operations["PlatformV2AgentAnalysisGet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        InfoResp: {
            capabilities: string[];
            mqttBroker: string;
            name: string;
            /** @description API version of the requested HTTP entry point */
            version: string;
        };
        AuthWhoamiResp: {
            apiKeyName: string;
            email: string;
            keyPrefix: string;
            keyType: string;
            permissions: string[];
            roles: string[];
            userID: number | bigint;
            userName: string;
            workspaceID: number | bigint;
            workspaceName: string;
        };
        AssetFileUploadReq: {
            appInstanceId?: string;
            business?: string;
            contentType?: string;
            fileName: string;
            sessionId?: string;
            size: number | bigint;
            useBy?: string;
            visibility?: string;
        };
        AssetFileUploadResp: {
            expiresAt?: number | bigint;
            fileId?: number | bigint;
            filePath: string;
            fileUrl?: string;
            /** @description 先写入全部签名字段，再追加 file；policy 约束 key 和大小 */
            postFields: {
                [key: string]: string;
            };
            /** @description 预签名 POST 地址；multipart/form-data 上传 */
            postUrl: string;
        };
        AssetFileUrlResp: {
            expiresAt?: number | bigint;
            fileUrl: string;
        };
        AssetFileDeleteReq: {
            filePath: string;
        };
        AssetFileDeleteResp: {
            deleted: boolean;
        };
        AssetFileMultipartInitReq: {
            appInstanceId?: string;
            bizId?: string;
            business?: string;
            contentType?: string;
            fileName: string;
            partSize?: number | bigint;
            sessionId?: string;
            size: number | bigint;
            useBy?: string;
            visibility?: string;
        };
        AssetFileMultipartInitResp: {
            expiresAt: number | bigint;
            fileKey: string;
            filePath: string;
            partCount: number | bigint;
            partSize: number | bigint;
            uploadId: string;
        };
        AssetFileMultipartPartUrlsReq: {
            fileKey: string;
            partNumbers: (number | bigint)[];
            uploadId: string;
        };
        AssetFileMultipartPartUrlsResp: {
            partUrls: components["schemas"]["AssetFileMultipartPartUrl"][];
        };
        AssetFileMultipartPartUrl: {
            expiresAt: number | bigint;
            partNumber: number | bigint;
            url: string;
        };
        AssetFileMultipartCompleteReq: {
            fileKey: string;
            parts: components["schemas"]["AssetFileMultipartPart"][];
            uploadId: string;
        };
        AssetFileMultipartPart: {
            etag: string;
            partNumber: number | bigint;
        };
        AssetFileMultipartCompleteResp: {
            expiresAt?: number | bigint;
            filePath: string;
            fileUrl?: string;
            sizeBytes: number | bigint;
        };
        AssetFileMultipartAbortReq: {
            fileKey: string;
            uploadId: string;
        };
        AssetFileMultipartAbortResp: {
            aborted: number | bigint;
        };
        AssetUploadReq: {
            business?: string;
            contentType?: string;
            fileName: string;
            isPublic?: boolean;
            sha256?: string;
            size?: number | bigint;
            sizeBytes: number | bigint;
            storageKey?: string;
            useBy?: string;
        };
        AssetUploadResp: {
            filePath: string;
            fileUrl?: string;
            /** @description 先写入全部签名字段，再追加 file；policy 约束 key 和大小 */
            postFields: {
                [key: string]: string;
            };
            /** @description 预签名 POST 地址；multipart/form-data 上传 */
            postUrl: string;
        };
        SendNotificationReq: {
            channels?: ("web" | "mobile")[];
            content: string;
            idempotencyKey: string;
            link?: string;
            mode?: string;
            recipientUserId: string;
            sender?: components["schemas"]["NotificationSender"];
            /** @description 已废弃：过渡期作 sender.name 别名（sender.name 优先），后续移除 */
            source?: string;
            title: string;
            type: string;
        };
        NotificationSender: {
            /** @description app 必填=appId（agent-platform UUID）；other 可选；system 可选；字符集 [0-9a-zA-Z-]{1,128} */
            id?: string;
            /** @description 类型专属附加信息，序列化后≤500字节 */
            meta?: {
                [key: string]: string;
            };
            /** @description 人读显示名（接替废弃的 source），≤100字符 */
            name?: string;
            /**
             * @description 枚举 app/other/system，缺省 other；system=平台内部服务，仅 usage_type=internal 的 API key 可用（否则 400），建信归 workspace 分组（System tab）
             * @default other
             * @enum {string}
             */
            type?: "app" | "other" | "system";
        };
        SendNotificationResp: {
            createdAt: string;
            messageId: string;
            status: string;
        };
        NotificationError: {
            errorCode: string;
            message: string;
        };
        GetNotificationReq: {
            messageId: string;
        };
        GetNotificationResp: {
            completedAt?: string;
            createdAt: string;
            errorCode?: string;
            message?: string;
            messageId: string;
            status: string;
            type: string;
        };
        PlatformGetMembersReq: {
            keyword?: string;
            page?: number | bigint;
            roleKey?: string;
            roles?: string[];
            size?: number | bigint;
            statuses?: string[];
            updatedAtEnd?: string;
            updatedAtStart?: string;
        };
        PlatformMembersResp: {
            list: components["schemas"]["PlatformMemberResp"][];
            page: number | bigint;
            size: number | bigint;
            total: number | bigint;
        };
        PlatformMemberResp: {
            email?: string;
            nickName?: string;
            roles: components["schemas"]["PlatformMemberRoleResp"][];
            status: string;
            updatedAt: string;
            userId: string;
            userName?: string;
        };
        PlatformMemberRoleResp: {
            description?: string;
            roleId: string;
            roleKey: string;
            roleName?: string;
        };
        AppAccessMembersListReq: {
            appId: string;
            /** @description 毫秒，闭区间，精度为秒 */
            grantedAtEnd?: number | bigint;
            /** @description 毫秒，闭区间，精度为秒 */
            grantedAtStart?: number | bigint;
            page?: number | bigint;
            /** @description 任一命中即可，大小写不敏感 */
            roleKeys?: string[];
            size?: number | bigint;
        };
        AppAccessMembersListResp: {
            /** @description 1:所有 active 成员都可访问 2:按角色授权 */
            allActiveMembers: number | bigint;
            appId: string;
            list: components["schemas"]["AppAccessMemberResp"][];
            page: number | bigint;
            productionVersionId?: string;
            /** @description 1:已发布 2:未发布 */
            published: number | bigint;
            roles: components["schemas"]["AppAccessRoleResp"][];
            size: number | bigint;
            total: number | bigint;
        };
        AppAccessMemberResp: {
            email?: string;
            /** @description 毫秒 */
            grantedAt: number | bigint;
            roles: components["schemas"]["AppAccessMemberRoleResp"][];
            userId: string;
            userName?: string;
        };
        AppAccessMemberRoleResp: {
            roleId: string;
            roleKey: string;
            roleName: string;
            sources: components["schemas"]["AppAccessRoleSourceResp"][];
        };
        AppAccessRoleSourceResp: {
            groupId?: string;
            groupName?: string;
            /** @description direct / group */
            type: string;
        };
        AppAccessRoleResp: {
            description?: string;
            memberCount: number | bigint;
            roleId: string;
            roleKey: string;
            roleName: string;
            /** @description active / retired */
            status: string;
        };
        MqttAuthCreateReq: {
            clientIDRandomSuffixEnabled?: boolean;
            description?: string;
            name: string;
        };
        MqttAuthCreateResp: {
            clientID: string;
            clientIDRandomSuffixEnabled: boolean;
            id: number | bigint;
            name: string;
            password: string;
            username: string;
        };
        MqttAuthDeleteReq: {
            id: number | bigint;
        };
        MqttAuthDeleteResp: {
            success: boolean;
        };
        /**
         * Tier0 capability discovery 2.0
         * @description OpenAPI 3.0 wire schema. Array contains/cardinality annotations and cross-field proof ordering require the shared JSON Schema plus SDK semantic checks; this projection alone is not full contract acceptance.
         */
        CapabilityDiscoverV2Resp: {
            /** @enum {unknown} */
            product: "cloud" | "enterprise";
            productVersion?: string;
            /** @enum {unknown} */
            contractVersion: "2.0";
            apiContractVersions: string[];
            sdkContractVersions: string[];
            capabilities: components["schemas"]["CapabilityDiscoverycapability"][] & (unknown & unknown & unknown & unknown & unknown);
            deprecations: {
                contract: string;
                replacement?: string;
                sunsetAt?: string;
            }[];
        };
        /** @description Unknown capability codes are ignored; only recognized codes use the frozen assessment contract. */
        CapabilityDiscoverycapability: {
            code: string;
        } & (unknown | components["schemas"]["CapabilityDiscoveryknownCapability"]);
        /** @description State reports publication and assessed prerequisites only; ready never grants resource access or confirms an actual execution. */
        CapabilityDiscoveryknownCapability: {
            /** @enum {unknown} */
            state: "disabled" | "not_supported" | "unavailable" | "readiness_unknown" | "ready";
            reasonCode: string;
            /** Format: date-time */
            checkedAt?: string;
            /**
             * Format: date-time
             * @description Proof expiry must follow checkedAt. Cross-field chronological ordering is a semantic constraint checked by consumers in addition to this structural JSON Schema.
             */
            validUntil?: string;
            retryAfterMs?: number | bigint;
            code: string;
            contractVersions: string[];
            operations?: components["schemas"]["CapabilityDiscoveryoperation"][];
        } & ((unknown | {
            /** @enum {unknown} */
            state?: "ready";
            checkedAt: unknown;
        }) & (unknown | ({
            operations?: ((unknown | components["schemas"]["CapabilityDiscoveryknownOperation"]) & (unknown | {
                /** @enum {unknown} */
                requiresResourceCheck?: true;
            }))[] & (unknown & unknown & unknown & unknown & unknown & unknown);
        } & (unknown | {
            operations?: (unknown | {
                /** @enum {unknown} */
                state?: "disabled";
            })[];
        }))) & (unknown | ({
            operations?: ((unknown | components["schemas"]["CapabilityDiscoveryknownOperation"]) & (unknown | {
                /** @enum {unknown} */
                requiresResourceCheck?: true;
            }))[] & (unknown & unknown & unknown & unknown & unknown & unknown);
        } & (unknown | {
            operations?: (unknown | {
                /** @enum {unknown} */
                state?: "disabled";
            })[];
        }))) & (unknown | {
            contractVersions?: unknown[];
        }) & (unknown | {
            contractVersions?: unknown[] & (unknown & unknown);
        }));
        /** @description Unknown operation names are ignored within their parent capability; known names are validated by that capability. */
        CapabilityDiscoveryoperation: {
            operation: string;
        };
        /** @description State reports publication and assessed prerequisites only; ready never grants resource access or confirms an actual execution. */
        CapabilityDiscoveryknownOperation: {
            /** @enum {unknown} */
            state: "disabled" | "not_supported" | "unavailable" | "readiness_unknown" | "ready";
            reasonCode: string;
            /** Format: date-time */
            checkedAt?: string;
            /**
             * Format: date-time
             * @description Proof expiry must follow checkedAt. Cross-field chronological ordering is a semantic constraint checked by consumers in addition to this structural JSON Schema.
             */
            validUntil?: string;
            retryAfterMs?: number | bigint;
            operation: string;
            requiresResourceCheck: boolean;
        } & (unknown | {
            /** @enum {unknown} */
            state?: "ready";
            checkedAt: unknown;
        });
        CapabilityErrorResp: {
            /** @description INVALID_CREDENTIAL / CAPABILITY_INVALID_REQUEST / CAPABILITY_FORBIDDEN / CAPABILITY_UNAVAILABLE / CAPABILITY_INTERNAL_ERROR */
            errorCode: string;
            /** @description 固定公开消息，不透传内部异常 */
            message: string;
        };
        AgentCardGetReq: {
            canvasId: string;
            cardId: string;
        };
        AgentCardGetResp: {
            canvasId: string;
            cardId: string;
            cardKey: string;
            cardSpec: unknown;
            updatedAt: number | bigint;
        };
        AgentResultCreateReq: {
            cardSpec?: unknown;
            dataScope?: unknown;
            images?: unknown[];
            missingData: unknown;
            operationId: string;
            resultSchemaVersion: number | bigint;
            source: components["schemas"]["AgentResultSource"];
            steps?: unknown[];
            summary?: string;
            tables?: unknown[];
            title: string;
            warnings?: string[];
        };
        AgentResultSource: {
            agentId: string;
            platformRunId?: string;
            platformSessionId: string;
            platformUserId?: string;
            skillVersion?: string;
        };
        AgentResultCreateResp: {
            jobRunId: string;
            resultId: string;
        };
        AgentResultGetReq: {
            /** @description 与resultId二选一，保存超时后按原编号查回，不重复保存 */
            operationId?: string;
            resultId?: string;
        };
        AgentResultGetResp: {
            result: components["schemas"]["AgentStoredResult"];
        };
        AgentStoredResult: {
            agentId: string;
            byteSize: number | bigint;
            cardSpec?: unknown;
            createdAt: number | bigint;
            manifest: unknown;
            operationId: string;
            platformRunId: string;
            platformSessionId: string;
            resultId: string;
            skillVersion: string;
            sourceKind: string;
        };
        AgentResultListReq: {
            page: number | bigint;
            platformSessionId?: string;
            size: number | bigint;
        };
        AgentResultListResp: {
            list: components["schemas"]["AgentStoredResult"][];
            page: number | bigint;
            size: number | bigint;
            total: number | bigint;
        };
        AgentCardUpdateReq: {
            canvasId?: string;
            cardId: string;
            cardSpec: unknown;
            /** @description 读取到的完整原卡内容，变化时返回HTTP409 */
            expectedCardSpec: unknown;
            /** @description 画布内顺序：不传 = 不改（转调 unssvr 时补 -1），传了原样透传；用指针区分「没传」和「传 0」 */
            ord?: number | bigint;
            position?: unknown;
        };
        AgentCardUpdateResp: {
            cardId: string;
        };
        AgentCardListReq: {
            canvasId: string;
            page: number | bigint;
            size: number | bigint;
        };
        AgentCardListResp: {
            list: components["schemas"]["AgentCardGetResp"][];
            page: number | bigint;
            size: number | bigint;
            total: number | bigint;
        };
        AgentResultPinReq: {
            canvasId: string;
            position?: unknown;
            resultId: string;
        };
        AgentResultPinResp: {
            cardId: string;
        };
        AgentJobCreateReq: {
            cardId?: string;
            cronExpr?: string;
            expiresAt?: number | bigint;
            intervalSeconds?: number | bigint;
            name: string;
            notify?: unknown;
            scheduleKind: string;
            sessionId: string;
            sourceBlockId?: string;
            sourceId?: string;
            sourceName?: string;
            sourceType: string;
            task: unknown;
            type?: string;
        };
        AgentJobMutationResp: {
            jobId: string;
        };
        AgentJobUpdateReq: {
            cardId?: string;
            cronExpr?: string;
            expiresAt?: number | bigint;
            intervalSeconds?: number | bigint;
            jobId: string;
            name?: string;
            notify?: unknown;
            /** @description 省略沿用原通知，1必须提供notify对象，2关闭通知且不提供notify */
            notifyEnabled?: number | bigint;
            scheduleKind?: string;
            sessionId?: string;
            sourceBlockId?: string;
            sourceId?: string;
            sourceName?: string;
            sourceType?: string;
            task?: unknown;
            type?: string;
        };
        AgentJobIDReq: {
            jobId: string;
        };
        AgentJobGetResp: {
            job: components["schemas"]["AgentJobRecord"];
        };
        AgentJobRecord: {
            attentionReason: string;
            cardId: string;
            createdAt: number | bigint;
            cronExpr: string;
            expiresAt: number | bigint;
            intervalSeconds: number | bigint;
            jobId: string;
            lastFiredAt: number | bigint;
            name: string;
            nextRunAt: number | bigint;
            notify?: unknown;
            orphanedAt: number | bigint;
            scheduleKind: string;
            sessionId: string;
            sourceBlockId: string;
            sourceId: string;
            sourceName: string;
            sourceType: string;
            status: string;
            task: unknown;
            type: string;
            updatedAt: number | bigint;
        };
        AgentJobListReq: {
            cardId?: string;
            page: number | bigint;
            search?: string;
            size: number | bigint;
            sourceId?: string;
            sourceType?: string;
            /** @description active / paused / needs_attention / expired */
            status?: string;
            type?: string;
        };
        AgentJobListResp: {
            list: components["schemas"]["AgentJobRecord"][];
            page: number | bigint;
            size: number | bigint;
            total: number | bigint;
        };
        AgentJobRunGetReq: {
            jobId: string;
            jobRunId: string;
        };
        AgentJobRunGetResp: {
            run: components["schemas"]["AgentJobRunRecord"];
        };
        AgentJobRunRecord: {
            dispatchState: string;
            errorCode?: string;
            errorMessage?: string;
            finishedAt?: number | bigint;
            firedAt: number | bigint;
            jobId: string;
            jobRunId: string;
            resultId?: string;
            resultSummary?: unknown;
            severity?: string;
            status: string;
            trigger?: string;
        };
        AgentJobRunListReq: {
            jobId: string;
            page: number | bigint;
            size: number | bigint;
            status?: string;
        };
        AgentJobRunListResp: {
            list: components["schemas"]["AgentJobRunRecord"][];
            page: number | bigint;
            size: number | bigint;
            total: number | bigint;
        };
        AgentJobTriggerResp: {
            dispatchState: string;
            jobId: string;
            jobRunId: string;
        };
        AgentCanvasListReq: {
            page: number | bigint;
            sessionId?: string;
            size: number | bigint;
        };
        AgentCanvasListResp: {
            list: components["schemas"]["AgentCanvasRecord"][];
            page: number | bigint;
            size: number | bigint;
            total: number | bigint;
        };
        AgentCanvasRecord: {
            canvasId: string;
            createdAt: number | bigint;
            name: string;
            sessionId: string;
            updatedAt: number | bigint;
        };
        AgentLibraryListReq: {
            page: number | bigint;
            search?: string;
            size: number | bigint;
            tags?: string[];
        };
        AgentLibraryListResp: {
            list: components["schemas"]["AgentLibraryItem"][];
            page: number | bigint;
            size: number | bigint;
            total: number | bigint;
        };
        AgentLibraryItem: {
            cardKey: string;
            cardSpec: unknown;
            createdAt: number | bigint;
            libraryItemId: string;
            sourceSessionId: string;
            tags: string[];
            updatedAt: number | bigint;
        };
        AgentLibraryGetReq: {
            libraryItemId: string;
        };
        AgentLibraryGetResp: {
            item: components["schemas"]["AgentLibraryItem"];
        };
        AgentLibraryCreateReq: {
            cardKey: string;
            cardSpec: unknown;
            sourceSessionId?: string;
            tags?: string[];
        };
        AgentLibraryMutationResp: {
            libraryItemId: string;
        };
        AgentLibraryUpdateReq: {
            cardSpec: unknown;
            expectedItem: components["schemas"]["AgentLibrarySnapshot"];
            libraryItemId: string;
            sourceSessionId?: string;
            tags?: string[];
        };
        AgentLibrarySnapshot: {
            cardKey: string;
            cardSpec: unknown;
            sourceSessionId: string;
            tags: string[];
        };
        AgentCardDeleteReq: {
            canvasId: string;
            cardId: string;
            expectedCardSpec: unknown;
        };
        AgentCardDeleteResp: {
            cardId: string;
        };
        AgentAnalysisDispatchReq: {
            canvasId?: string;
            cardId?: string;
            kind: string;
            operationId: string;
            resultId?: string;
            task: unknown;
        };
        AgentAnalysisDispatchResp: {
            dispatchState: string;
            errorCode: string;
            errorMessage: string;
            runId: string;
        };
        AgentAnalysisGetReq: {
            runId: string;
        };
        AgentAnalysisGetResp: {
            run: components["schemas"]["AgentJobRunRecord"];
        };
        SdksystemInfoData: components["schemas"]["InfoResp"];
        SdksystemInfoWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdksystemInfoData"];
        };
        SdksystemWhoamiData: components["schemas"]["AuthWhoamiResp"];
        SdksystemWhoamiWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdksystemWhoamiData"];
        };
        SdkassetsFilesPrepareUploadRequest: components["schemas"]["AssetFileUploadReq"];
        SdkassetsFilesPrepareUploadData: components["schemas"]["AssetFileUploadResp"];
        SdkassetsFilesPrepareUploadWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsFilesPrepareUploadData"];
        };
        SdkassetsFilesDownloadQuery: {
            filePath: string;
            responseContentDisposition?: string;
        };
        SdkassetsFilesDownloadData: unknown;
        SdkassetsFilesDownloadWire: components["schemas"]["SdkassetsFilesDownloadData"];
        SdkassetsFilesUrlQuery: {
            filePath: string;
            expiredSec?: number | bigint;
        };
        SdkassetsFilesUrlData: components["schemas"]["AssetFileUrlResp"];
        SdkassetsFilesUrlWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsFilesUrlData"];
        };
        SdkassetsFilesDeleteRequest: components["schemas"]["AssetFileDeleteReq"];
        SdkassetsFilesDeleteData: components["schemas"]["AssetFileDeleteResp"];
        SdkassetsFilesDeleteWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsFilesDeleteData"];
        };
        SdkassetsFilesMultipartInitRequest: components["schemas"]["AssetFileMultipartInitReq"];
        SdkassetsFilesMultipartInitData: components["schemas"]["AssetFileMultipartInitResp"];
        SdkassetsFilesMultipartInitWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsFilesMultipartInitData"];
        };
        SdkassetsFilesMultipartPartUrlsRequest: components["schemas"]["AssetFileMultipartPartUrlsReq"];
        SdkassetsFilesMultipartPartUrlsData: components["schemas"]["AssetFileMultipartPartUrlsResp"];
        SdkassetsFilesMultipartPartUrlsWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsFilesMultipartPartUrlsData"];
        };
        SdkassetsFilesMultipartCompleteRequest: components["schemas"]["AssetFileMultipartCompleteReq"];
        SdkassetsFilesMultipartCompleteData: components["schemas"]["AssetFileMultipartCompleteResp"];
        SdkassetsFilesMultipartCompleteWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsFilesMultipartCompleteData"];
        };
        SdkassetsFilesMultipartAbortRequest: components["schemas"]["AssetFileMultipartAbortReq"];
        SdkassetsFilesMultipartAbortData: components["schemas"]["AssetFileMultipartAbortResp"];
        SdkassetsFilesMultipartAbortWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsFilesMultipartAbortData"];
        };
        SdkassetsUploadRequest: components["schemas"]["AssetUploadReq"];
        SdkassetsUploadData: components["schemas"]["AssetUploadResp"];
        SdkassetsUploadWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkassetsUploadData"];
        };
        SdknotificationsSendRequest: components["schemas"]["SendNotificationReq"];
        SdknotificationsSendData: components["schemas"]["SendNotificationResp"];
        SdknotificationsSendWire: components["schemas"]["SdknotificationsSendData"];
        SdknotificationsGetRequest: components["schemas"]["GetNotificationReq"];
        SdknotificationsGetData: components["schemas"]["GetNotificationResp"];
        SdknotificationsGetWire: components["schemas"]["SdknotificationsGetData"];
        SdkmembersListWorkspaceRequest: components["schemas"]["PlatformGetMembersReq"];
        SdkmembersListWorkspaceData: components["schemas"]["PlatformMembersResp"];
        SdkmembersListWorkspaceWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkmembersListWorkspaceData"];
        };
        SdkmembersListAppRequest: components["schemas"]["AppAccessMembersListReq"];
        SdkmembersListAppData: components["schemas"]["AppAccessMembersListResp"];
        SdkmembersListAppWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkmembersListAppData"];
        };
        SdkmqttAuthCreateRequest: components["schemas"]["MqttAuthCreateReq"];
        SdkmqttAuthCreateData: components["schemas"]["MqttAuthCreateResp"];
        SdkmqttAuthCreateWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkmqttAuthCreateData"];
        };
        SdkmqttAuthDeleteRequest: components["schemas"]["MqttAuthDeleteReq"];
        SdkmqttAuthDeleteData: components["schemas"]["MqttAuthDeleteResp"];
        SdkmqttAuthDeleteWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkmqttAuthDeleteData"];
        };
        SdkcapabilitiesDiscoverData: components["schemas"]["CapabilityDiscoverV2Resp"];
        SdkcapabilitiesDiscoverWire: components["schemas"]["SdkcapabilitiesDiscoverData"];
        SdkagentCardsGetRequest: components["schemas"]["AgentCardGetReq"];
        SdkagentCardsGetData: components["schemas"]["AgentCardGetResp"];
        SdkagentCardsGetWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentCardsGetData"];
        };
        SdkagentResultsCreateRequest: components["schemas"]["AgentResultCreateReq"];
        SdkagentResultsCreateData: components["schemas"]["AgentResultCreateResp"];
        SdkagentResultsCreateWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentResultsCreateData"];
        };
        SdkagentResultsGetRequest: components["schemas"]["AgentResultGetReq"];
        SdkagentResultsGetData: components["schemas"]["AgentResultGetResp"];
        SdkagentResultsGetWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentResultsGetData"];
        };
        SdkagentResultsListRequest: components["schemas"]["AgentResultListReq"];
        SdkagentResultsListData: components["schemas"]["AgentResultListResp"];
        SdkagentResultsListWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentResultsListData"];
        };
        SdkagentCardsUpdateRequest: components["schemas"]["AgentCardUpdateReq"];
        SdkagentCardsUpdateData: components["schemas"]["AgentCardUpdateResp"];
        SdkagentCardsUpdateWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentCardsUpdateData"];
        };
        SdkagentCardsListRequest: components["schemas"]["AgentCardListReq"];
        SdkagentCardsListData: components["schemas"]["AgentCardListResp"];
        SdkagentCardsListWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentCardsListData"];
        };
        SdkagentResultsPinRequest: components["schemas"]["AgentResultPinReq"];
        SdkagentResultsPinData: components["schemas"]["AgentResultPinResp"];
        SdkagentResultsPinWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentResultsPinData"];
        };
        SdkagentJobsCreateRequest: components["schemas"]["AgentJobCreateReq"];
        SdkagentJobsCreateData: components["schemas"]["AgentJobMutationResp"];
        SdkagentJobsCreateWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsCreateData"];
        };
        SdkagentJobsUpdateRequest: components["schemas"]["AgentJobUpdateReq"];
        SdkagentJobsUpdateData: components["schemas"]["AgentJobMutationResp"];
        SdkagentJobsUpdateWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsUpdateData"];
        };
        SdkagentJobsGetRequest: components["schemas"]["AgentJobIDReq"];
        SdkagentJobsGetData: components["schemas"]["AgentJobGetResp"];
        SdkagentJobsGetWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsGetData"];
        };
        SdkagentJobsListRequest: components["schemas"]["AgentJobListReq"];
        SdkagentJobsListData: components["schemas"]["AgentJobListResp"];
        SdkagentJobsListWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsListData"];
        };
        SdkagentJobsPauseRequest: components["schemas"]["AgentJobIDReq"];
        SdkagentJobsPauseData: components["schemas"]["AgentJobMutationResp"];
        SdkagentJobsPauseWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsPauseData"];
        };
        SdkagentJobsResumeRequest: components["schemas"]["AgentJobIDReq"];
        SdkagentJobsResumeData: components["schemas"]["AgentJobMutationResp"];
        SdkagentJobsResumeWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsResumeData"];
        };
        SdkagentJobsDeleteRequest: components["schemas"]["AgentJobIDReq"];
        SdkagentJobsDeleteData: components["schemas"]["AgentJobMutationResp"];
        SdkagentJobsDeleteWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsDeleteData"];
        };
        SdkagentJobRunsGetRequest: components["schemas"]["AgentJobRunGetReq"];
        SdkagentJobRunsGetData: components["schemas"]["AgentJobRunGetResp"];
        SdkagentJobRunsGetWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobRunsGetData"];
        };
        SdkagentJobRunsListRequest: components["schemas"]["AgentJobRunListReq"];
        SdkagentJobRunsListData: components["schemas"]["AgentJobRunListResp"];
        SdkagentJobRunsListWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobRunsListData"];
        };
        SdkagentJobsTriggerRequest: components["schemas"]["AgentJobIDReq"];
        SdkagentJobsTriggerData: components["schemas"]["AgentJobTriggerResp"];
        SdkagentJobsTriggerWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentJobsTriggerData"];
        };
        SdkagentCanvasesListRequest: components["schemas"]["AgentCanvasListReq"];
        SdkagentCanvasesListData: components["schemas"]["AgentCanvasListResp"];
        SdkagentCanvasesListWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentCanvasesListData"];
        };
        SdkagentLibraryListRequest: components["schemas"]["AgentLibraryListReq"];
        SdkagentLibraryListData: components["schemas"]["AgentLibraryListResp"];
        SdkagentLibraryListWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentLibraryListData"];
        };
        SdkagentLibraryGetRequest: components["schemas"]["AgentLibraryGetReq"];
        SdkagentLibraryGetData: components["schemas"]["AgentLibraryGetResp"];
        SdkagentLibraryGetWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentLibraryGetData"];
        };
        SdkagentLibraryCreateRequest: components["schemas"]["AgentLibraryCreateReq"];
        SdkagentLibraryCreateData: components["schemas"]["AgentLibraryMutationResp"];
        SdkagentLibraryCreateWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentLibraryCreateData"];
        };
        SdkagentLibraryUpdateRequest: components["schemas"]["AgentLibraryUpdateReq"];
        SdkagentLibraryUpdateData: components["schemas"]["AgentLibraryMutationResp"];
        SdkagentLibraryUpdateWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentLibraryUpdateData"];
        };
        SdkagentLibraryDeleteRequest: components["schemas"]["AgentLibraryGetReq"];
        SdkagentLibraryDeleteData: components["schemas"]["AgentLibraryMutationResp"];
        SdkagentLibraryDeleteWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentLibraryDeleteData"];
        };
        SdkagentCardsDeleteRequest: components["schemas"]["AgentCardDeleteReq"];
        SdkagentCardsDeleteData: components["schemas"]["AgentCardDeleteResp"];
        SdkagentCardsDeleteWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentCardsDeleteData"];
        };
        SdkagentAnalysesDispatchRequest: components["schemas"]["AgentAnalysisDispatchReq"];
        SdkagentAnalysesDispatchData: components["schemas"]["AgentAnalysisDispatchResp"];
        SdkagentAnalysesDispatchWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentAnalysesDispatchData"];
        };
        SdkagentAnalysesGetRequest: components["schemas"]["AgentAnalysisGetReq"];
        SdkagentAnalysesGetData: components["schemas"]["AgentAnalysisGetResp"];
        SdkagentAnalysesGetWire: {
            code: number | bigint;
            msg: string;
            data: components["schemas"]["SdkagentAnalysesGetData"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    PlatformV2Info: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdksystemInfoWire"];
                };
            };
        };
    };
    PlatformV2Whoami: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdksystemWhoamiWire"];
                };
            };
        };
    };
    PlatformV2AssetFileUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetFileUploadReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsFilesPrepareUploadWire"];
                };
            };
        };
    };
    PlatformV2AssetFileDownload: {
        parameters: {
            query: {
                filePath: string;
                responseContentDisposition?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Redirect to the public or short-lived signed download URL. */
            302: {
                headers: {
                    Location?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PlatformV2AssetFileUrl: {
        parameters: {
            query: {
                filePath: string;
                expiredSec?: number | bigint;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsFilesUrlWire"];
                };
            };
        };
    };
    PlatformV2AssetFileDelete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetFileDeleteReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsFilesDeleteWire"];
                };
            };
        };
    };
    PlatformV2AssetFileMultipartInit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetFileMultipartInitReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsFilesMultipartInitWire"];
                };
            };
        };
    };
    PlatformV2AssetFileMultipartPartUrls: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetFileMultipartPartUrlsReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsFilesMultipartPartUrlsWire"];
                };
            };
        };
    };
    PlatformV2AssetFileMultipartComplete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetFileMultipartCompleteReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsFilesMultipartCompleteWire"];
                };
            };
        };
    };
    PlatformV2AssetFileMultipartAbort: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetFileMultipartAbortReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsFilesMultipartAbortWire"];
                };
            };
        };
    };
    PlatformV2AssetUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetUploadReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkassetsUploadWire"];
                };
            };
        };
    };
    PlatformV2SendNotification: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SendNotificationReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdknotificationsSendWire"];
                };
            };
            /** @description Platform operation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
        };
    };
    PlatformV2GetNotification: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GetNotificationReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdknotificationsGetWire"];
                };
            };
            /** @description Platform operation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
            /** @description Platform operation failed. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationError"];
                };
            };
        };
    };
    PlatformV2GetMembers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlatformGetMembersReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkmembersListWorkspaceWire"];
                };
            };
        };
    };
    PlatformV2ListAccessMembers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AppAccessMembersListReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkmembersListAppWire"];
                };
            };
        };
    };
    PlatformV2Create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MqttAuthCreateReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkmqttAuthCreateWire"];
                };
            };
        };
    };
    PlatformV2Delete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MqttAuthDeleteReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkmqttAuthDeleteWire"];
                };
            };
        };
    };
    PlatformV2CapabilityDiscoverV2: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkcapabilitiesDiscoverWire"];
                };
            };
            /** @description Platform operation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityErrorResp"];
                };
            };
            /** @description Platform operation failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityErrorResp"];
                };
            };
            /** @description Platform operation failed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityErrorResp"];
                };
            };
            /** @description Platform operation failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityErrorResp"];
                };
            };
            /** @description Platform operation failed. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityErrorResp"];
                };
            };
        };
    };
    PlatformV2AgentCardGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentCardGetReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentCardsGetWire"];
                };
            };
        };
    };
    PlatformV2AgentResultCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentResultCreateReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentResultsCreateWire"];
                };
            };
        };
    };
    PlatformV2AgentResultGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentResultGetReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentResultsGetWire"];
                };
            };
        };
    };
    PlatformV2AgentResultList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentResultListReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentResultsListWire"];
                };
            };
        };
    };
    PlatformV2AgentCardUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentCardUpdateReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentCardsUpdateWire"];
                };
            };
        };
    };
    PlatformV2AgentCardList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentCardListReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentCardsListWire"];
                };
            };
        };
    };
    PlatformV2AgentResultPin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentResultPinReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentResultsPinWire"];
                };
            };
        };
    };
    PlatformV2AgentJobCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobCreateReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsCreateWire"];
                };
            };
        };
    };
    PlatformV2AgentJobUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobUpdateReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsUpdateWire"];
                };
            };
        };
    };
    PlatformV2AgentJobGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobIDReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsGetWire"];
                };
            };
        };
    };
    PlatformV2AgentJobList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobListReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsListWire"];
                };
            };
        };
    };
    PlatformV2AgentJobPause: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobIDReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsPauseWire"];
                };
            };
        };
    };
    PlatformV2AgentJobResume: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobIDReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsResumeWire"];
                };
            };
        };
    };
    PlatformV2AgentJobDelete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobIDReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsDeleteWire"];
                };
            };
        };
    };
    PlatformV2AgentJobRunGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobRunGetReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobRunsGetWire"];
                };
            };
        };
    };
    PlatformV2AgentJobRunList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobRunListReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobRunsListWire"];
                };
            };
        };
    };
    PlatformV2AgentJobTrigger: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentJobIDReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentJobsTriggerWire"];
                };
            };
        };
    };
    PlatformV2AgentCanvasList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentCanvasListReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentCanvasesListWire"];
                };
            };
        };
    };
    PlatformV2AgentLibraryList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentLibraryListReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentLibraryListWire"];
                };
            };
        };
    };
    PlatformV2AgentLibraryGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentLibraryGetReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentLibraryGetWire"];
                };
            };
        };
    };
    PlatformV2AgentLibraryCreate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentLibraryCreateReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentLibraryCreateWire"];
                };
            };
        };
    };
    PlatformV2AgentLibraryUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentLibraryUpdateReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentLibraryUpdateWire"];
                };
            };
        };
    };
    PlatformV2AgentLibraryDelete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentLibraryGetReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentLibraryDeleteWire"];
                };
            };
        };
    };
    PlatformV2AgentCardDelete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentCardDeleteReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentCardsDeleteWire"];
                };
            };
        };
    };
    PlatformV2AgentAnalysisDispatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentAnalysisDispatchReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentAnalysesDispatchWire"];
                };
            };
        };
    };
    PlatformV2AgentAnalysisGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentAnalysisGetReq"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SdkagentAnalysesGetWire"];
                };
            };
        };
    };
}
