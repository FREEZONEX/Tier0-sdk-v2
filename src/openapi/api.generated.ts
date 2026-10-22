// Generated. Stable names follow public resource paths, not goctl operationId.
import type { HttpClient, RequestOptions } from './client.js';
import type { components } from './types.generated.js';

export const OPENAPI_OPERATIONS = {
  "agentAnalysesDispatch": {
    "name": "agentAnalysesDispatch",
    "method": "POST",
    "path": "/openapi/v1/agent/analyses/dispatch",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentAnalysesDispatchRequest",
    "responseSchema": "V1_SdkagentAnalysesDispatchWire"
  },
  "agentAnalysesGet": {
    "name": "agentAnalysesGet",
    "method": "POST",
    "path": "/openapi/v1/agent/analyses/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentAnalysesGetRequest",
    "responseSchema": "V1_SdkagentAnalysesGetWire"
  },
  "agentCanvasesList": {
    "name": "agentCanvasesList",
    "method": "POST",
    "path": "/openapi/v1/agent/canvases/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentCanvasesListRequest",
    "responseSchema": "V1_SdkagentCanvasesListWire"
  },
  "agentCardsDelete": {
    "name": "agentCardsDelete",
    "method": "POST",
    "path": "/openapi/v1/agent/cards/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentCardsDeleteRequest",
    "responseSchema": "V1_SdkagentCardsDeleteWire"
  },
  "agentCardsGet": {
    "name": "agentCardsGet",
    "method": "POST",
    "path": "/openapi/v1/agent/cards/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentCardsGetRequest",
    "responseSchema": "V1_SdkagentCardsGetWire"
  },
  "agentCardsList": {
    "name": "agentCardsList",
    "method": "POST",
    "path": "/openapi/v1/agent/cards/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentCardsListRequest",
    "responseSchema": "V1_SdkagentCardsListWire"
  },
  "agentCardsUpdate": {
    "name": "agentCardsUpdate",
    "method": "POST",
    "path": "/openapi/v1/agent/cards/update",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentCardsUpdateRequest",
    "responseSchema": "V1_SdkagentCardsUpdateWire"
  },
  "agentJobRunsGet": {
    "name": "agentJobRunsGet",
    "method": "POST",
    "path": "/openapi/v1/agent/job-runs/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentJobRunsGetRequest",
    "responseSchema": "V1_SdkagentJobRunsGetWire"
  },
  "agentJobRunsList": {
    "name": "agentJobRunsList",
    "method": "POST",
    "path": "/openapi/v1/agent/job-runs/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentJobRunsListRequest",
    "responseSchema": "V1_SdkagentJobRunsListWire"
  },
  "agentJobsCreate": {
    "name": "agentJobsCreate",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentJobsCreateRequest",
    "responseSchema": "V1_SdkagentJobsCreateWire"
  },
  "agentJobsDelete": {
    "name": "agentJobsDelete",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentJobsDeleteRequest",
    "responseSchema": "V1_SdkagentJobsDeleteWire"
  },
  "agentJobsGet": {
    "name": "agentJobsGet",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentJobsGetRequest",
    "responseSchema": "V1_SdkagentJobsGetWire"
  },
  "agentJobsList": {
    "name": "agentJobsList",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentJobsListRequest",
    "responseSchema": "V1_SdkagentJobsListWire"
  },
  "agentJobsPause": {
    "name": "agentJobsPause",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/pause",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentJobsPauseRequest",
    "responseSchema": "V1_SdkagentJobsPauseWire"
  },
  "agentJobsResume": {
    "name": "agentJobsResume",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/resume",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentJobsResumeRequest",
    "responseSchema": "V1_SdkagentJobsResumeWire"
  },
  "agentJobsTrigger": {
    "name": "agentJobsTrigger",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/trigger",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentJobsTriggerRequest",
    "responseSchema": "V1_SdkagentJobsTriggerWire"
  },
  "agentJobsUpdate": {
    "name": "agentJobsUpdate",
    "method": "POST",
    "path": "/openapi/v1/agent/jobs/update",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentJobsUpdateRequest",
    "responseSchema": "V1_SdkagentJobsUpdateWire"
  },
  "agentLibraryCreate": {
    "name": "agentLibraryCreate",
    "method": "POST",
    "path": "/openapi/v1/agent/library/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentLibraryCreateRequest",
    "responseSchema": "V1_SdkagentLibraryCreateWire"
  },
  "agentLibraryDelete": {
    "name": "agentLibraryDelete",
    "method": "POST",
    "path": "/openapi/v1/agent/library/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentLibraryDeleteRequest",
    "responseSchema": "V1_SdkagentLibraryDeleteWire"
  },
  "agentLibraryGet": {
    "name": "agentLibraryGet",
    "method": "POST",
    "path": "/openapi/v1/agent/library/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentLibraryGetRequest",
    "responseSchema": "V1_SdkagentLibraryGetWire"
  },
  "agentLibraryList": {
    "name": "agentLibraryList",
    "method": "POST",
    "path": "/openapi/v1/agent/library/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentLibraryListRequest",
    "responseSchema": "V1_SdkagentLibraryListWire"
  },
  "agentLibraryUpdate": {
    "name": "agentLibraryUpdate",
    "method": "POST",
    "path": "/openapi/v1/agent/library/update",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentLibraryUpdateRequest",
    "responseSchema": "V1_SdkagentLibraryUpdateWire"
  },
  "agentNodesIndexSync": {
    "name": "agentNodesIndexSync",
    "method": "POST",
    "path": "/openapi/v1/agent/nodes/index-sync",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "responseSchema": "V1_SdkagentNodesIndexSyncWire"
  },
  "agentNodesSearchSemantic": {
    "name": "agentNodesSearchSemantic",
    "method": "POST",
    "path": "/openapi/v1/agent/nodes/search-semantic",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentNodesSearchSemanticRequest",
    "responseSchema": "V1_SdkagentNodesSearchSemanticWire"
  },
  "agentRelationsList": {
    "name": "agentRelationsList",
    "method": "POST",
    "path": "/openapi/v1/agent/relations/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentRelationsListRequest",
    "responseSchema": "V1_SdkagentRelationsListWire"
  },
  "agentRelationsTeach": {
    "name": "agentRelationsTeach",
    "method": "POST",
    "path": "/openapi/v1/agent/relations/teach",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentRelationsTeachRequest",
    "responseSchema": "V1_SdkagentRelationsTeachWire"
  },
  "agentResultsCreate": {
    "name": "agentResultsCreate",
    "method": "POST",
    "path": "/openapi/v1/agent/results/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentResultsCreateRequest",
    "responseSchema": "V1_SdkagentResultsCreateWire"
  },
  "agentResultsGet": {
    "name": "agentResultsGet",
    "method": "POST",
    "path": "/openapi/v1/agent/results/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentResultsGetRequest",
    "responseSchema": "V1_SdkagentResultsGetWire"
  },
  "agentResultsList": {
    "name": "agentResultsList",
    "method": "POST",
    "path": "/openapi/v1/agent/results/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkagentResultsListRequest",
    "responseSchema": "V1_SdkagentResultsListWire"
  },
  "agentResultsPin": {
    "name": "agentResultsPin",
    "method": "POST",
    "path": "/openapi/v1/agent/results/pin",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkagentResultsPinRequest",
    "responseSchema": "V1_SdkagentResultsPinWire"
  },
  "membersListApp": {
    "name": "membersListApp",
    "method": "POST",
    "path": "/openapi/v1/apps/access-members/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkmembersListAppRequest",
    "responseSchema": "V1_SdkmembersListAppWire"
  },
  "assetsFilesPrepareUpload": {
    "name": "assetsFilesPrepareUpload",
    "method": "POST",
    "path": "/openapi/v1/assets/files",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkassetsFilesPrepareUploadRequest",
    "responseSchema": "V1_SdkassetsFilesPrepareUploadWire"
  },
  "assetsFilesDelete": {
    "name": "assetsFilesDelete",
    "method": "POST",
    "path": "/openapi/v1/assets/files/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkassetsFilesDeleteRequest",
    "responseSchema": "V1_SdkassetsFilesDeleteWire"
  },
  "assetsFilesDownload": {
    "name": "assetsFilesDownload",
    "method": "GET",
    "path": "/openapi/v1/assets/files/download",
    "pathParams": [],
    "mode": "download",
    "readonly": true,
    "responseSchema": "V1_SdkassetsFilesDownloadWire"
  },
  "assetsFilesMultipartAbort": {
    "name": "assetsFilesMultipartAbort",
    "method": "POST",
    "path": "/openapi/v1/assets/files/multipart/abort",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkassetsFilesMultipartAbortRequest",
    "responseSchema": "V1_SdkassetsFilesMultipartAbortWire"
  },
  "assetsFilesMultipartComplete": {
    "name": "assetsFilesMultipartComplete",
    "method": "POST",
    "path": "/openapi/v1/assets/files/multipart/complete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkassetsFilesMultipartCompleteRequest",
    "responseSchema": "V1_SdkassetsFilesMultipartCompleteWire"
  },
  "assetsFilesMultipartInit": {
    "name": "assetsFilesMultipartInit",
    "method": "POST",
    "path": "/openapi/v1/assets/files/multipart/init",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkassetsFilesMultipartInitRequest",
    "responseSchema": "V1_SdkassetsFilesMultipartInitWire"
  },
  "assetsFilesMultipartPartUrls": {
    "name": "assetsFilesMultipartPartUrls",
    "method": "POST",
    "path": "/openapi/v1/assets/files/multipart/part-urls",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkassetsFilesMultipartPartUrlsRequest",
    "responseSchema": "V1_SdkassetsFilesMultipartPartUrlsWire"
  },
  "assetsFilesUrl": {
    "name": "assetsFilesUrl",
    "method": "GET",
    "path": "/openapi/v1/assets/files/url",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "responseSchema": "V1_SdkassetsFilesUrlWire"
  },
  "assetsUpload": {
    "name": "assetsUpload",
    "method": "POST",
    "path": "/openapi/v1/assets/upload",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkassetsUploadRequest",
    "responseSchema": "V1_SdkassetsUploadWire"
  },
  "systemWhoami": {
    "name": "systemWhoami",
    "method": "POST",
    "path": "/openapi/v1/auth/whoami",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "responseSchema": "V1_SdksystemWhoamiWire"
  },
  "capabilitiesDiscover": {
    "name": "capabilitiesDiscover",
    "method": "POST",
    "path": "/openapi/v1/capabilities/discover",
    "pathParams": [],
    "mode": "direct",
    "readonly": true,
    "responseSchema": "V1_SdkcapabilitiesDiscoverWire"
  },
  "controlsDiscover": {
    "name": "controlsDiscover",
    "method": "POST",
    "path": "/openapi/v1/controls/discover",
    "pathParams": [],
    "mode": "direct",
    "readonly": true,
    "requestSchema": "V1_SdkcontrolsDiscoverRequest",
    "responseSchema": "V1_SdkcontrolsDiscoverWire"
  },
  "controlsDescribe": {
    "name": "controlsDescribe",
    "method": "POST",
    "path": "/openapi/v1/controls/{controlCode}/describe",
    "pathParams": [
      "controlCode"
    ],
    "mode": "direct",
    "readonly": true,
    "responseSchema": "V1_SdkcontrolsDescribeWire"
  },
  "controlsInvoke": {
    "name": "controlsInvoke",
    "method": "POST",
    "path": "/openapi/v1/controls/{controlCode}/invoke",
    "pathParams": [
      "controlCode"
    ],
    "mode": "direct",
    "readonly": false,
    "requestSchema": "V1_SdkcontrolsInvokeRequest",
    "responseSchema": "V1_SdkcontrolsInvokeWire"
  },
  "systemInfo": {
    "name": "systemInfo",
    "method": "POST",
    "path": "/openapi/v1/info",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "responseSchema": "V1_SdksystemInfoWire"
  },
  "mqttAuthCreate": {
    "name": "mqttAuthCreate",
    "method": "POST",
    "path": "/openapi/v1/mqtt-auth/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkmqttAuthCreateRequest",
    "responseSchema": "V1_SdkmqttAuthCreateWire"
  },
  "mqttAuthDelete": {
    "name": "mqttAuthDelete",
    "method": "POST",
    "path": "/openapi/v1/mqtt-auth/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "V1_SdkmqttAuthDeleteRequest",
    "responseSchema": "V1_SdkmqttAuthDeleteWire"
  },
  "notificationsGet": {
    "name": "notificationsGet",
    "method": "POST",
    "path": "/openapi/v1/notifications/get",
    "pathParams": [],
    "mode": "direct",
    "readonly": true,
    "requestSchema": "V1_SdknotificationsGetRequest",
    "responseSchema": "V1_SdknotificationsGetWire"
  },
  "notificationsSend": {
    "name": "notificationsSend",
    "method": "POST",
    "path": "/openapi/v1/notifications/send",
    "pathParams": [],
    "mode": "direct",
    "readonly": false,
    "requestSchema": "V1_SdknotificationsSendRequest",
    "responseSchema": "V1_SdknotificationsSendWire"
  },
  "membersListWorkspace": {
    "name": "membersListWorkspace",
    "method": "POST",
    "path": "/openapi/v1/platform/getMembers",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "V1_SdkmembersListWorkspaceRequest",
    "responseSchema": "V1_SdkmembersListWorkspaceWire"
  }
} as const;

export function createOpenAPI(http: HttpClient) {
  return {
  "agent": {
    "analyses": {
      "dispatch": (body: components['schemas']["SdkagentAnalysesDispatchRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentAnalysesDispatchData"]>(OPENAPI_OPERATIONS["agentAnalysesDispatch"], { body }, options),
      "get": (body: components['schemas']["SdkagentAnalysesGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentAnalysesGetData"]>(OPENAPI_OPERATIONS["agentAnalysesGet"], { body }, options),
    },
    "canvases": {
      "list": (body: components['schemas']["SdkagentCanvasesListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCanvasesListData"]>(OPENAPI_OPERATIONS["agentCanvasesList"], { body }, options),
    },
    "cards": {
      "delete": (body: components['schemas']["SdkagentCardsDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsDeleteData"]>(OPENAPI_OPERATIONS["agentCardsDelete"], { body }, options),
      "get": (body: components['schemas']["SdkagentCardsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsGetData"]>(OPENAPI_OPERATIONS["agentCardsGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentCardsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsListData"]>(OPENAPI_OPERATIONS["agentCardsList"], { body }, options),
      "update": (body: components['schemas']["SdkagentCardsUpdateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsUpdateData"]>(OPENAPI_OPERATIONS["agentCardsUpdate"], { body }, options),
    },
    "jobRuns": {
      "get": (body: components['schemas']["SdkagentJobRunsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobRunsGetData"]>(OPENAPI_OPERATIONS["agentJobRunsGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentJobRunsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobRunsListData"]>(OPENAPI_OPERATIONS["agentJobRunsList"], { body }, options),
    },
    "jobs": {
      "create": (body: components['schemas']["SdkagentJobsCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsCreateData"]>(OPENAPI_OPERATIONS["agentJobsCreate"], { body }, options),
      "delete": (body: components['schemas']["SdkagentJobsDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsDeleteData"]>(OPENAPI_OPERATIONS["agentJobsDelete"], { body }, options),
      "get": (body: components['schemas']["SdkagentJobsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsGetData"]>(OPENAPI_OPERATIONS["agentJobsGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentJobsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsListData"]>(OPENAPI_OPERATIONS["agentJobsList"], { body }, options),
      "pause": (body: components['schemas']["SdkagentJobsPauseRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsPauseData"]>(OPENAPI_OPERATIONS["agentJobsPause"], { body }, options),
      "resume": (body: components['schemas']["SdkagentJobsResumeRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsResumeData"]>(OPENAPI_OPERATIONS["agentJobsResume"], { body }, options),
      "trigger": (body: components['schemas']["SdkagentJobsTriggerRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsTriggerData"]>(OPENAPI_OPERATIONS["agentJobsTrigger"], { body }, options),
      "update": (body: components['schemas']["SdkagentJobsUpdateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsUpdateData"]>(OPENAPI_OPERATIONS["agentJobsUpdate"], { body }, options),
    },
    "library": {
      "create": (body: components['schemas']["SdkagentLibraryCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryCreateData"]>(OPENAPI_OPERATIONS["agentLibraryCreate"], { body }, options),
      "delete": (body: components['schemas']["SdkagentLibraryDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryDeleteData"]>(OPENAPI_OPERATIONS["agentLibraryDelete"], { body }, options),
      "get": (body: components['schemas']["SdkagentLibraryGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryGetData"]>(OPENAPI_OPERATIONS["agentLibraryGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentLibraryListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryListData"]>(OPENAPI_OPERATIONS["agentLibraryList"], { body }, options),
      "update": (body: components['schemas']["SdkagentLibraryUpdateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryUpdateData"]>(OPENAPI_OPERATIONS["agentLibraryUpdate"], { body }, options),
    },
    "nodes": {
      "indexSync": (options?: RequestOptions) => http.operation<components['schemas']["SdkagentNodesIndexSyncData"]>(OPENAPI_OPERATIONS["agentNodesIndexSync"], {  }, options),
      "searchSemantic": (body: components['schemas']["SdkagentNodesSearchSemanticRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentNodesSearchSemanticData"]>(OPENAPI_OPERATIONS["agentNodesSearchSemantic"], { body }, options),
    },
    "relations": {
      "list": (body: components['schemas']["SdkagentRelationsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentRelationsListData"]>(OPENAPI_OPERATIONS["agentRelationsList"], { body }, options),
      "teach": (body: components['schemas']["SdkagentRelationsTeachRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentRelationsTeachData"]>(OPENAPI_OPERATIONS["agentRelationsTeach"], { body }, options),
    },
    "results": {
      "create": (body: components['schemas']["SdkagentResultsCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsCreateData"]>(OPENAPI_OPERATIONS["agentResultsCreate"], { body }, options),
      "get": (body?: components['schemas']["SdkagentResultsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsGetData"]>(OPENAPI_OPERATIONS["agentResultsGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentResultsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsListData"]>(OPENAPI_OPERATIONS["agentResultsList"], { body }, options),
      "pin": (body: components['schemas']["SdkagentResultsPinRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsPinData"]>(OPENAPI_OPERATIONS["agentResultsPin"], { body }, options),
    },
  },
  "members": {
    "listApp": (body: components['schemas']["SdkmembersListAppRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmembersListAppData"]>(OPENAPI_OPERATIONS["membersListApp"], { body }, options),
    "listWorkspace": (body?: components['schemas']["SdkmembersListWorkspaceRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmembersListWorkspaceData"]>(OPENAPI_OPERATIONS["membersListWorkspace"], { body }, options),
  },
  "assets": {
    "files": {
      "prepareUpload": (body: components['schemas']["SdkassetsFilesPrepareUploadRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesPrepareUploadData"]>(OPENAPI_OPERATIONS["assetsFilesPrepareUpload"], { body }, options),
      "delete": (body: components['schemas']["SdkassetsFilesDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesDeleteData"]>(OPENAPI_OPERATIONS["assetsFilesDelete"], { body }, options),
      "download": (query: components['schemas']["SdkassetsFilesDownloadQuery"], options?: RequestOptions) => http.operation<Response>(OPENAPI_OPERATIONS["assetsFilesDownload"], { query }, options),
      "multipart": {
        "abort": (body: components['schemas']["SdkassetsFilesMultipartAbortRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartAbortData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartAbort"], { body }, options),
        "complete": (body: components['schemas']["SdkassetsFilesMultipartCompleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartCompleteData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartComplete"], { body }, options),
        "init": (body: components['schemas']["SdkassetsFilesMultipartInitRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartInitData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartInit"], { body }, options),
        "partUrls": (body: components['schemas']["SdkassetsFilesMultipartPartUrlsRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartPartUrlsData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartPartUrls"], { body }, options),
      },
      "url": (query: components['schemas']["SdkassetsFilesUrlQuery"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesUrlData"]>(OPENAPI_OPERATIONS["assetsFilesUrl"], { query }, options),
    },
    "upload": (body: components['schemas']["SdkassetsUploadRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsUploadData"]>(OPENAPI_OPERATIONS["assetsUpload"], { body }, options),
  },
  "system": {
    "whoami": (options?: RequestOptions) => http.operation<components['schemas']["SdksystemWhoamiData"]>(OPENAPI_OPERATIONS["systemWhoami"], {  }, options),
    "info": (options?: RequestOptions) => http.operation<components['schemas']["SdksystemInfoData"]>(OPENAPI_OPERATIONS["systemInfo"], {  }, options),
  },
  "capabilities": {
    "discover": (options?: RequestOptions) => http.operation<components['schemas']["SdkcapabilitiesDiscoverData"]>(OPENAPI_OPERATIONS["capabilitiesDiscover"], {  }, options),
  },
  "controls": {
    "discover": (body?: components['schemas']["SdkcontrolsDiscoverRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkcontrolsDiscoverData"]>(OPENAPI_OPERATIONS["controlsDiscover"], { body }, options),
    "describe": (params: { "controlCode": string }, options?: RequestOptions) => http.operation<components['schemas']["SdkcontrolsDescribeData"]>(OPENAPI_OPERATIONS["controlsDescribe"], { params }, options),
    "invoke": (params: { "controlCode": string }, body: components['schemas']["SdkcontrolsInvokeRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkcontrolsInvokeData"]>(OPENAPI_OPERATIONS["controlsInvoke"], { params, body }, options),
  },
  "mqttAuth": {
    "create": (body: components['schemas']["SdkmqttAuthCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmqttAuthCreateData"]>(OPENAPI_OPERATIONS["mqttAuthCreate"], { body }, options),
    "delete": (body: components['schemas']["SdkmqttAuthDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmqttAuthDeleteData"]>(OPENAPI_OPERATIONS["mqttAuthDelete"], { body }, options),
  },
  "notifications": {
    "get": (body: components['schemas']["SdknotificationsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdknotificationsGetData"]>(OPENAPI_OPERATIONS["notificationsGet"], { body }, options),
    "send": (body: components['schemas']["SdknotificationsSendRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdknotificationsSendData"]>(OPENAPI_OPERATIONS["notificationsSend"], { body }, options),
  },
};
}
export type OpenAPI = ReturnType<typeof createOpenAPI>;
