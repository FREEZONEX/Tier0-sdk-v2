// Generated. Stable names follow public resource paths, not goctl operationId.
import type { HttpClient, RequestOptions } from './client.js';
import type { components } from './types.generated.js';

export const OPENAPI_OPERATIONS = {
  "systemInfo": {
    "name": "systemInfo",
    "method": "POST",
    "path": "/openapi/v2/info",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "responseSchema": "Platform_SdksystemInfoWire"
  },
  "systemWhoami": {
    "name": "systemWhoami",
    "method": "POST",
    "path": "/openapi/v2/auth/whoami",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "responseSchema": "Platform_SdksystemWhoamiWire"
  },
  "assetsFilesPrepareUpload": {
    "name": "assetsFilesPrepareUpload",
    "method": "POST",
    "path": "/openapi/v2/assets/files",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkassetsFilesPrepareUploadRequest",
    "responseSchema": "Platform_SdkassetsFilesPrepareUploadWire"
  },
  "assetsFilesDownload": {
    "name": "assetsFilesDownload",
    "method": "GET",
    "path": "/openapi/v2/assets/files/download",
    "pathParams": [],
    "mode": "download",
    "readonly": true,
    "responseSchema": "Platform_SdkassetsFilesDownloadWire"
  },
  "assetsFilesUrl": {
    "name": "assetsFilesUrl",
    "method": "GET",
    "path": "/openapi/v2/assets/files/url",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "responseSchema": "Platform_SdkassetsFilesUrlWire"
  },
  "assetsFilesDelete": {
    "name": "assetsFilesDelete",
    "method": "POST",
    "path": "/openapi/v2/assets/files/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkassetsFilesDeleteRequest",
    "responseSchema": "Platform_SdkassetsFilesDeleteWire"
  },
  "assetsFilesMultipartInit": {
    "name": "assetsFilesMultipartInit",
    "method": "POST",
    "path": "/openapi/v2/assets/files/multipart/init",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkassetsFilesMultipartInitRequest",
    "responseSchema": "Platform_SdkassetsFilesMultipartInitWire"
  },
  "assetsFilesMultipartPartUrls": {
    "name": "assetsFilesMultipartPartUrls",
    "method": "POST",
    "path": "/openapi/v2/assets/files/multipart/part-urls",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkassetsFilesMultipartPartUrlsRequest",
    "responseSchema": "Platform_SdkassetsFilesMultipartPartUrlsWire"
  },
  "assetsFilesMultipartComplete": {
    "name": "assetsFilesMultipartComplete",
    "method": "POST",
    "path": "/openapi/v2/assets/files/multipart/complete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkassetsFilesMultipartCompleteRequest",
    "responseSchema": "Platform_SdkassetsFilesMultipartCompleteWire"
  },
  "assetsFilesMultipartAbort": {
    "name": "assetsFilesMultipartAbort",
    "method": "POST",
    "path": "/openapi/v2/assets/files/multipart/abort",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkassetsFilesMultipartAbortRequest",
    "responseSchema": "Platform_SdkassetsFilesMultipartAbortWire"
  },
  "assetsUpload": {
    "name": "assetsUpload",
    "method": "POST",
    "path": "/openapi/v2/assets/upload",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkassetsUploadRequest",
    "responseSchema": "Platform_SdkassetsUploadWire"
  },
  "notificationsSend": {
    "name": "notificationsSend",
    "method": "POST",
    "path": "/openapi/v2/notifications/send",
    "pathParams": [],
    "mode": "direct",
    "readonly": false,
    "requestSchema": "Platform_SdknotificationsSendRequest",
    "responseSchema": "Platform_SdknotificationsSendWire"
  },
  "notificationsGet": {
    "name": "notificationsGet",
    "method": "POST",
    "path": "/openapi/v2/notifications/get",
    "pathParams": [],
    "mode": "direct",
    "readonly": true,
    "requestSchema": "Platform_SdknotificationsGetRequest",
    "responseSchema": "Platform_SdknotificationsGetWire"
  },
  "membersListWorkspace": {
    "name": "membersListWorkspace",
    "method": "POST",
    "path": "/openapi/v2/platform/getMembers",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkmembersListWorkspaceRequest",
    "responseSchema": "Platform_SdkmembersListWorkspaceWire"
  },
  "membersListApp": {
    "name": "membersListApp",
    "method": "POST",
    "path": "/openapi/v2/apps/access-members/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkmembersListAppRequest",
    "responseSchema": "Platform_SdkmembersListAppWire"
  },
  "mqttAuthCreate": {
    "name": "mqttAuthCreate",
    "method": "POST",
    "path": "/openapi/v2/mqtt-auth/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkmqttAuthCreateRequest",
    "responseSchema": "Platform_SdkmqttAuthCreateWire"
  },
  "mqttAuthDelete": {
    "name": "mqttAuthDelete",
    "method": "POST",
    "path": "/openapi/v2/mqtt-auth/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkmqttAuthDeleteRequest",
    "responseSchema": "Platform_SdkmqttAuthDeleteWire"
  },
  "capabilitiesDiscover": {
    "name": "capabilitiesDiscover",
    "method": "POST",
    "path": "/openapi/v2/capabilities/discover",
    "pathParams": [],
    "mode": "direct",
    "readonly": true,
    "responseSchema": "Platform_SdkcapabilitiesDiscoverWire"
  },
  "agentCardsGet": {
    "name": "agentCardsGet",
    "method": "POST",
    "path": "/openapi/v2/agent/cards/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentCardsGetRequest",
    "responseSchema": "Platform_SdkagentCardsGetWire"
  },
  "agentResultsCreate": {
    "name": "agentResultsCreate",
    "method": "POST",
    "path": "/openapi/v2/agent/results/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentResultsCreateRequest",
    "responseSchema": "Platform_SdkagentResultsCreateWire"
  },
  "agentResultsGet": {
    "name": "agentResultsGet",
    "method": "POST",
    "path": "/openapi/v2/agent/results/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentResultsGetRequest",
    "responseSchema": "Platform_SdkagentResultsGetWire"
  },
  "agentResultsList": {
    "name": "agentResultsList",
    "method": "POST",
    "path": "/openapi/v2/agent/results/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentResultsListRequest",
    "responseSchema": "Platform_SdkagentResultsListWire"
  },
  "agentCardsUpdate": {
    "name": "agentCardsUpdate",
    "method": "POST",
    "path": "/openapi/v2/agent/cards/update",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentCardsUpdateRequest",
    "responseSchema": "Platform_SdkagentCardsUpdateWire"
  },
  "agentCardsList": {
    "name": "agentCardsList",
    "method": "POST",
    "path": "/openapi/v2/agent/cards/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentCardsListRequest",
    "responseSchema": "Platform_SdkagentCardsListWire"
  },
  "agentResultsPin": {
    "name": "agentResultsPin",
    "method": "POST",
    "path": "/openapi/v2/agent/results/pin",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentResultsPinRequest",
    "responseSchema": "Platform_SdkagentResultsPinWire"
  },
  "agentJobsCreate": {
    "name": "agentJobsCreate",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentJobsCreateRequest",
    "responseSchema": "Platform_SdkagentJobsCreateWire"
  },
  "agentJobsUpdate": {
    "name": "agentJobsUpdate",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/update",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentJobsUpdateRequest",
    "responseSchema": "Platform_SdkagentJobsUpdateWire"
  },
  "agentJobsGet": {
    "name": "agentJobsGet",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentJobsGetRequest",
    "responseSchema": "Platform_SdkagentJobsGetWire"
  },
  "agentJobsList": {
    "name": "agentJobsList",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentJobsListRequest",
    "responseSchema": "Platform_SdkagentJobsListWire"
  },
  "agentJobsPause": {
    "name": "agentJobsPause",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/pause",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentJobsPauseRequest",
    "responseSchema": "Platform_SdkagentJobsPauseWire"
  },
  "agentJobsResume": {
    "name": "agentJobsResume",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/resume",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentJobsResumeRequest",
    "responseSchema": "Platform_SdkagentJobsResumeWire"
  },
  "agentJobsDelete": {
    "name": "agentJobsDelete",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentJobsDeleteRequest",
    "responseSchema": "Platform_SdkagentJobsDeleteWire"
  },
  "agentJobRunsGet": {
    "name": "agentJobRunsGet",
    "method": "POST",
    "path": "/openapi/v2/agent/job-runs/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentJobRunsGetRequest",
    "responseSchema": "Platform_SdkagentJobRunsGetWire"
  },
  "agentJobRunsList": {
    "name": "agentJobRunsList",
    "method": "POST",
    "path": "/openapi/v2/agent/job-runs/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentJobRunsListRequest",
    "responseSchema": "Platform_SdkagentJobRunsListWire"
  },
  "agentJobsTrigger": {
    "name": "agentJobsTrigger",
    "method": "POST",
    "path": "/openapi/v2/agent/jobs/trigger",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentJobsTriggerRequest",
    "responseSchema": "Platform_SdkagentJobsTriggerWire"
  },
  "agentCanvasesList": {
    "name": "agentCanvasesList",
    "method": "POST",
    "path": "/openapi/v2/agent/canvases/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentCanvasesListRequest",
    "responseSchema": "Platform_SdkagentCanvasesListWire"
  },
  "agentLibraryList": {
    "name": "agentLibraryList",
    "method": "POST",
    "path": "/openapi/v2/agent/library/list",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentLibraryListRequest",
    "responseSchema": "Platform_SdkagentLibraryListWire"
  },
  "agentLibraryGet": {
    "name": "agentLibraryGet",
    "method": "POST",
    "path": "/openapi/v2/agent/library/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentLibraryGetRequest",
    "responseSchema": "Platform_SdkagentLibraryGetWire"
  },
  "agentLibraryCreate": {
    "name": "agentLibraryCreate",
    "method": "POST",
    "path": "/openapi/v2/agent/library/create",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentLibraryCreateRequest",
    "responseSchema": "Platform_SdkagentLibraryCreateWire"
  },
  "agentLibraryUpdate": {
    "name": "agentLibraryUpdate",
    "method": "POST",
    "path": "/openapi/v2/agent/library/update",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentLibraryUpdateRequest",
    "responseSchema": "Platform_SdkagentLibraryUpdateWire"
  },
  "agentLibraryDelete": {
    "name": "agentLibraryDelete",
    "method": "POST",
    "path": "/openapi/v2/agent/library/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentLibraryDeleteRequest",
    "responseSchema": "Platform_SdkagentLibraryDeleteWire"
  },
  "agentCardsDelete": {
    "name": "agentCardsDelete",
    "method": "POST",
    "path": "/openapi/v2/agent/cards/delete",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentCardsDeleteRequest",
    "responseSchema": "Platform_SdkagentCardsDeleteWire"
  },
  "agentAnalysesDispatch": {
    "name": "agentAnalysesDispatch",
    "method": "POST",
    "path": "/openapi/v2/agent/analyses/dispatch",
    "pathParams": [],
    "mode": "envelope",
    "readonly": false,
    "requestSchema": "Platform_SdkagentAnalysesDispatchRequest",
    "responseSchema": "Platform_SdkagentAnalysesDispatchWire"
  },
  "agentAnalysesGet": {
    "name": "agentAnalysesGet",
    "method": "POST",
    "path": "/openapi/v2/agent/analyses/get",
    "pathParams": [],
    "mode": "envelope",
    "readonly": true,
    "requestSchema": "Platform_SdkagentAnalysesGetRequest",
    "responseSchema": "Platform_SdkagentAnalysesGetWire"
  }
} as const;

export function createOpenAPI(http: HttpClient) {
  return {
  "system": {
    "info": (options?: RequestOptions) => http.operation<components['schemas']["SdksystemInfoData"]>(OPENAPI_OPERATIONS["systemInfo"], {  }, options),
    "whoami": (options?: RequestOptions) => http.operation<components['schemas']["SdksystemWhoamiData"]>(OPENAPI_OPERATIONS["systemWhoami"], {  }, options),
  },
  "assets": {
    "files": {
      "prepareUpload": (body: components['schemas']["SdkassetsFilesPrepareUploadRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesPrepareUploadData"]>(OPENAPI_OPERATIONS["assetsFilesPrepareUpload"], { body }, options),
      "download": (query: components['schemas']["SdkassetsFilesDownloadQuery"], options?: RequestOptions) => http.operation<Response>(OPENAPI_OPERATIONS["assetsFilesDownload"], { query }, options),
      "url": (query: components['schemas']["SdkassetsFilesUrlQuery"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesUrlData"]>(OPENAPI_OPERATIONS["assetsFilesUrl"], { query }, options),
      "delete": (body: components['schemas']["SdkassetsFilesDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesDeleteData"]>(OPENAPI_OPERATIONS["assetsFilesDelete"], { body }, options),
      "multipart": {
        "init": (body: components['schemas']["SdkassetsFilesMultipartInitRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartInitData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartInit"], { body }, options),
        "partUrls": (body: components['schemas']["SdkassetsFilesMultipartPartUrlsRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartPartUrlsData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartPartUrls"], { body }, options),
        "complete": (body: components['schemas']["SdkassetsFilesMultipartCompleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartCompleteData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartComplete"], { body }, options),
        "abort": (body: components['schemas']["SdkassetsFilesMultipartAbortRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsFilesMultipartAbortData"]>(OPENAPI_OPERATIONS["assetsFilesMultipartAbort"], { body }, options),
      },
    },
    "upload": (body: components['schemas']["SdkassetsUploadRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkassetsUploadData"]>(OPENAPI_OPERATIONS["assetsUpload"], { body }, options),
  },
  "notifications": {
    "send": (body: components['schemas']["SdknotificationsSendRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdknotificationsSendData"]>(OPENAPI_OPERATIONS["notificationsSend"], { body }, options),
    "get": (body: components['schemas']["SdknotificationsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdknotificationsGetData"]>(OPENAPI_OPERATIONS["notificationsGet"], { body }, options),
  },
  "members": {
    "listWorkspace": (body?: components['schemas']["SdkmembersListWorkspaceRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmembersListWorkspaceData"]>(OPENAPI_OPERATIONS["membersListWorkspace"], { body }, options),
    "listApp": (body: components['schemas']["SdkmembersListAppRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmembersListAppData"]>(OPENAPI_OPERATIONS["membersListApp"], { body }, options),
  },
  "mqttAuth": {
    "create": (body: components['schemas']["SdkmqttAuthCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmqttAuthCreateData"]>(OPENAPI_OPERATIONS["mqttAuthCreate"], { body }, options),
    "delete": (body: components['schemas']["SdkmqttAuthDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkmqttAuthDeleteData"]>(OPENAPI_OPERATIONS["mqttAuthDelete"], { body }, options),
  },
  "capabilities": {
    "discover": (options?: RequestOptions) => http.operation<components['schemas']["SdkcapabilitiesDiscoverData"]>(OPENAPI_OPERATIONS["capabilitiesDiscover"], {  }, options),
  },
  "agent": {
    "cards": {
      "get": (body: components['schemas']["SdkagentCardsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsGetData"]>(OPENAPI_OPERATIONS["agentCardsGet"], { body }, options),
      "update": (body: components['schemas']["SdkagentCardsUpdateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsUpdateData"]>(OPENAPI_OPERATIONS["agentCardsUpdate"], { body }, options),
      "list": (body: components['schemas']["SdkagentCardsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsListData"]>(OPENAPI_OPERATIONS["agentCardsList"], { body }, options),
      "delete": (body: components['schemas']["SdkagentCardsDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCardsDeleteData"]>(OPENAPI_OPERATIONS["agentCardsDelete"], { body }, options),
    },
    "results": {
      "create": (body: components['schemas']["SdkagentResultsCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsCreateData"]>(OPENAPI_OPERATIONS["agentResultsCreate"], { body }, options),
      "get": (body?: components['schemas']["SdkagentResultsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsGetData"]>(OPENAPI_OPERATIONS["agentResultsGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentResultsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsListData"]>(OPENAPI_OPERATIONS["agentResultsList"], { body }, options),
      "pin": (body: components['schemas']["SdkagentResultsPinRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentResultsPinData"]>(OPENAPI_OPERATIONS["agentResultsPin"], { body }, options),
    },
    "jobs": {
      "create": (body: components['schemas']["SdkagentJobsCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsCreateData"]>(OPENAPI_OPERATIONS["agentJobsCreate"], { body }, options),
      "update": (body: components['schemas']["SdkagentJobsUpdateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsUpdateData"]>(OPENAPI_OPERATIONS["agentJobsUpdate"], { body }, options),
      "get": (body: components['schemas']["SdkagentJobsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsGetData"]>(OPENAPI_OPERATIONS["agentJobsGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentJobsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsListData"]>(OPENAPI_OPERATIONS["agentJobsList"], { body }, options),
      "pause": (body: components['schemas']["SdkagentJobsPauseRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsPauseData"]>(OPENAPI_OPERATIONS["agentJobsPause"], { body }, options),
      "resume": (body: components['schemas']["SdkagentJobsResumeRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsResumeData"]>(OPENAPI_OPERATIONS["agentJobsResume"], { body }, options),
      "delete": (body: components['schemas']["SdkagentJobsDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsDeleteData"]>(OPENAPI_OPERATIONS["agentJobsDelete"], { body }, options),
      "trigger": (body: components['schemas']["SdkagentJobsTriggerRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobsTriggerData"]>(OPENAPI_OPERATIONS["agentJobsTrigger"], { body }, options),
    },
    "jobRuns": {
      "get": (body: components['schemas']["SdkagentJobRunsGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobRunsGetData"]>(OPENAPI_OPERATIONS["agentJobRunsGet"], { body }, options),
      "list": (body: components['schemas']["SdkagentJobRunsListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentJobRunsListData"]>(OPENAPI_OPERATIONS["agentJobRunsList"], { body }, options),
    },
    "canvases": {
      "list": (body: components['schemas']["SdkagentCanvasesListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentCanvasesListData"]>(OPENAPI_OPERATIONS["agentCanvasesList"], { body }, options),
    },
    "library": {
      "list": (body: components['schemas']["SdkagentLibraryListRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryListData"]>(OPENAPI_OPERATIONS["agentLibraryList"], { body }, options),
      "get": (body: components['schemas']["SdkagentLibraryGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryGetData"]>(OPENAPI_OPERATIONS["agentLibraryGet"], { body }, options),
      "create": (body: components['schemas']["SdkagentLibraryCreateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryCreateData"]>(OPENAPI_OPERATIONS["agentLibraryCreate"], { body }, options),
      "update": (body: components['schemas']["SdkagentLibraryUpdateRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryUpdateData"]>(OPENAPI_OPERATIONS["agentLibraryUpdate"], { body }, options),
      "delete": (body: components['schemas']["SdkagentLibraryDeleteRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentLibraryDeleteData"]>(OPENAPI_OPERATIONS["agentLibraryDelete"], { body }, options),
    },
    "analyses": {
      "dispatch": (body: components['schemas']["SdkagentAnalysesDispatchRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentAnalysesDispatchData"]>(OPENAPI_OPERATIONS["agentAnalysesDispatch"], { body }, options),
      "get": (body: components['schemas']["SdkagentAnalysesGetRequest"], options?: RequestOptions) => http.operation<components['schemas']["SdkagentAnalysesGetData"]>(OPENAPI_OPERATIONS["agentAnalysesGet"], { body }, options),
    },
  },
};
}
export type OpenAPI = ReturnType<typeof createOpenAPI>;
