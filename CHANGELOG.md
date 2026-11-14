# Changelog

## Unreleased

- Add optional `data.transact(..., { retryUnknown: false })` for workflows that must surface an unknown commit without receipt replay. The default retry policy remains unchanged; confirmed rolled-back retries still follow the server's retry contract.

- Add `collection.updateManyAtomic(filter, update, options)` for one server transaction over the complete matching range. It preserves update validation, array filters, idempotency, optional fresh declared-index checks, and database `$currentDate`; results expose counts, database transaction time, replay and dry-run status. The SDK never enumerates records, chunks the range, falls back to partial writes, or automatically resends an unknown outcome. Existing partial `updateMany` remains unchanged. Contracts are pinned to merged Backend `baee1fa79a3396fb57c8a23230b9c378e2d037cf`; the target environment must deploy this capability separately.

- Preserve optional `transactionTime` on successful `record.check`/`record.read` results and expose its numeric type in `TransactResultItem`. Result bindings may use `resultPath: 'transactionTime'` for database transaction start time in Unix milliseconds, or add `format: 'iso8601'` for a UTC string with three fractional digits. Formatting is only valid for the transaction clock and is performed by the server. Older results and bindings without a format remain compatible; the SDK never substitutes application time. `record.update` bindings to `$set`/`$setOnInsert` retain scalar placeholders for server resolution while still validating declared paths and unbound literals.

- Negotiate `data.transact` capacity from optional `AppContext.limits.transaction` for requests above 200 steps, up to a client ceiling of 10,000. `data.getTransactionLimits()` exposes fresh effective limits. Older servers and clients without an ensured App context retain 200; malformed capabilities or denied context reads fail closed. Collection `insertMany`/`bulkWrite` retain their 200-item ceiling. Larger business transactions remain one synchronous request, never split; the matching Backend patch must be deployed separately.
- Add `data.assertIndexesReady()` for a fresh App-key index-state check, including selected declarations, constraint identity, TTL settings and collection identity. `data.transact(steps, { requireIndexesReady: true })` checks the exact collection IDs before submission and rechecks after collection recovery. Missing/building/failed indexes reject instead of relying on cached ensure results; these are opt-in preflights, not metadata locks or a replacement for server-side constraints.
- Report requests aborted before transport as `DataError(DATA_ABORTED, notStarted)` consistently, including requests taking a free concurrency slot. Shared ensure/seed work remains independent of request cancellation.
- Reject unsupported collection index options (including partial predicates) and non-boolean `unique` values before platform I/O. JavaScript/JSON declarations can no longer silently lose constraints during schema compilation. This does not add platform support for partial indexes.

## 0.12.2 (2026-11-11)

- Synchronize Source/Stream contract diagnostics with Backend `0edf6335c76dfd442a071ee706be3a523c8ecbfb`, including App Stream execution identity, runtime and Source binding availability reasons.
- Document unified Stream execution identity and HTTP Source reuse of vendor authentication where supported by the target Backend; SDK updates do not deploy the Backend.

## 0.12.1 (2026-11-11)

- COLLECTION_NOT_GRANTED guidance no longer says only a workspace admin can add grants; the built-in Builder grants task-required access with appDataPolicyUpdate (uns-swe#965).
- Clarify HTTP Source URL and query forwarding, repeated query values, and how to distinguish platform errors from upstream HTTP responses.

## 0.12.0 (2026-11-11)

- Support minimal Stream request contracts that omit both `sideEffect` and `idempotency`; legacy explicit contracts retain both fields and their existing constraints. The corresponding public TypeScript properties are now optional.
- Describe optional transport deduplication keys and single-attempt invocation semantics; the SDK does not generate keys or automatically retry invocations.
- Synchronize the Stream interaction contract to Backend `df1bd75bd98d1c619c990c1cdeb63a4c4334851d`, preserve SQL query field exclusions in generated types, and simplify bundled Source, Stream and Collection guidance.

## 0.11.0 (2026-11-11)

- Breaking: `Visitor.subType` is only `employee`. `parseVisitorHeader()` refuses every other identity, including old machine headers with or without a grant. Employee grants remain mandatory (1–128 bytes); canonical encoding, field validation and App binding are unchanged. No machine alias or compatibility API is provided.
- Built on 0.10.1: keeps its committed Backend contract `07ef8cd30a5465a98c8e6ee0892d02360aee8761` and the unified Builder grant guidance, without editing generated contracts. App Key authentication (`TIER0_API_KEY` → one `X-API-Key`), employee roles, data cancellation, data and Stream APIs are unchanged.
- Existing deployed Apps retain their bundled parser. Retiring machine entry points and stripping untrusted identity headers at the platform front door invalidates old call tokens without republishing those Apps; updating this package alone does not secure an alternate ingress.

## 0.10.1-aenv.13 (local remove-apps-in-use integration)

- Rebase the employee-only visitor cutover onto 0.10.1, retaining its committed Backend contract `07ef8cd30a5465a98c8e6ee0892d02360aee8761` and unified Builder grant guidance without editing generated contracts.
- Repack for the scaffold as a distinct local artifact rather than replacing the historical 0.10.0-aenv.12 archive. No npm publication or existing App republication is performed.
- Machine visitor identities remain rejected; employee grants, platform App Keys, data and Stream APIs keep the latest base behavior.

## 0.10.1 (2026-11-10)

- Clarify Builder grant management for existing collections across Apps in the same workspace. Document incremental `appDataPolicyUpdate` changes, revision checks and receipt verification while preserving existing grants and disabled policy status; App runtime credentials cannot manage grants.
- Align README and bundled Skills with the Backend's unified authorization rules: management uses the current principal's effective workspace, App and resource permissions, without a separate Agent denial or platform-import exception.
- Synchronize generated contracts to committed Backend `07ef8cd30a5465a98c8e6ee0892d02360aee8761`, including the optional `permission` field in the platform identity response. No SDK operation is removed.

## 0.10.0-aenv.12 (local access-settings package)

- Breaking: `Visitor.subType` is only `employee`. `parseVisitorHeader()` refuses every other identity, including old machine headers with or without a grant. Employee grants remain mandatory; canonical encoding, field validation and App binding are unchanged. No machine alias or compatibility API is provided.
- App Key authentication (`TIER0_API_KEY` → one `X-API-Key`), employee roles, data cancellation and realtime APIs are unchanged. This local package keeps the existing 0.10.0 generated Backend contracts; no contract synchronization or Backend upgrade is part of this change.
- Existing deployed Apps retain their bundled parser. Retiring machine entry points and stripping untrusted identity headers at the platform front door invalidates old call tokens without republishing those Apps; updating this package alone does not secure an alternate ingress.

## 0.10.0 (2026-11-10)

First stable npm release of the new-architecture migration, including the changes recorded below for the local aenv-next prereleases and the 0.9.11 candidate.

- Breaking: hosted Apps call the platform as their own App Key. Employee delegation, visitor-token verification and per-App platform policies are removed; use `parseVisitorHeader()` for trusted front-door visitor context, `runWithAbortSignal()` for cancellation and `createChangeRelay()` for server-mediated realtime data.
- App platform capabilities are fixed by the Backend contract. MQTT topics use the App namespace through `appTopic()`; external collection grants require a workspace Owner/Admin.
- Include explicit credential-source isolation, asynchronous per-request `apiKeyProvider`, single-header `X-API-Key` authentication, static Data-client identity and MQTT reconnect fixes.
- Include the native Source/Stream contract and diagnostic updates. Deploy against a Backend and App runtime that support these contracts; the prior local prerelease entries below describe the migration details.

- Added typed `client.uns.sampleDeleteExact` for bounded, explicit `{recordId,id,time}` Sample deletion with preview, missing counts and idempotent receipts. This Workspace management operation is unavailable to App keys; no App data-layer delete method or acquisition deduplication is added.
- Synchronized the committed Backend contract at `91b5f3dc4024f44df32ee7aafcd83a8d470b655d`, including Stream observations' optional `view:'summary'|'full'` and optional diagnostics for summary responses, plus the optional `charts`, `findings`, `metrics` and `severity` fields on `AgentResultCreateReq`. Generated methods continue to preserve exact request identities and server retry advice without automatically retrying writes.

## 0.10.0-aenv.11 (local aenv-next prerelease)

Breaking: an App's key is collections plus a fixed set of platform capabilities; there is no per-App platform policy any more (Backend `app-key-model/1`).

- Removed with the Backend contract, without replacement: `client.uns.appStreamPolicyGet` / `appStreamPolicyUpdate` (`/openapi/v2/uns/app-stream-policy/get|update`), their raw operations and codec schemas, and the types `CloudAppStreamPolicy`, `CloudAppStreamPolicyGetReq`, `CloudAppStreamPolicyGetResponse`, `CloudAppStreamPolicyUpdateReq`, `CloudAppStreamPolicyMutationResponse` and `CloudStreamMessageTopicPermission`. Code that calls them no longer compiles; at runtime Backend has no such route.
- `AppContext.platformPermissions` (`uns.dataAppContext`) is the fixed 11 (`openapi.base`, `platform.users.read`, `notifications.send`, `asset.file.upload` / `download` / `delete`, `stream.requests.read` / `invoke` / `write`, `stream.messages.publish` / `subscribe`) intersected with the key's stored permissions, key mode and workspace plan; the enum gains `stream.messages.publish` / `subscribe` and has at most 11 items.
- New `appTopic(suffix)` in `@tier0/sdk-v2/mq`: returns `apps/<TIER0_APP_ID>/<TIER0_RUNTIME>/<suffix>`, the only MQTT namespace Backend lets an App's hosted key use (the Preview key `preview`, the deployed key `deployed`). It reads both variables on every call and throws when `TIER0_APP_ID` is missing or not a valid topic level, when `TIER0_RUNTIME` is not `preview` / `deployed`, or when the suffix is empty or starts with `/`; it never guesses a segment. MQTT examples use it.
- Docs and skills follow the new model: the hosted App key route allowlist adds `stream-requests/discover`, `stream-requests/<code>/describe|invoke`, `stream-messages/connect` and `capabilities/discover`; `client.streams` works for an App's server code (bounded by the workspace plan, Stream request grants and, for messages, the topics published Stream manifests declare, with no per-App topic list); platform capabilities and MQTT topics are no longer described as managed or approved by workspace admins in App settings; external collections are granted only by a workspace Owner/Admin, the publish-time confirmation is gone, and `appDataPolicyUpdate` refuses other callers' new grants with `app_grant_admin_required` / `app_grant_agent_forbidden`.
- Docs correct two claims: an App's key reaches only `assets/files/**` under `assets/` (the exact file routes Backend allows; `assets/upload` answers 403), not `assets/**`; and `TIER0_RUNTIME` is set only by the platform, so local development must not set it (it also picks the `members.listApp()` scope and platform proxy mode). `appTopic` is for previews and deployments only and throws outside the platform; to debug MQTT locally, write the full topic.
- Every contract input is synchronized from Backend `1e6b2d7b6de7795a6509e4aafc8cd04699f5d00f` (`app-key-model/1`); the Source/Stream, Stream diagnostics, capability and Stream request pins move to the same commit. The external App registration operations (`appRegistration*`) leave the manifest (they were Core-only and never exported). Other contract changes: the `appDataPolicyUpdate` description (admin-only additions), the `AppContext.platformPermissions` description, and a description on `CloudAppStreamAccessItem.blockedReasons` (`app_stream_ceiling` means the workspace plan lacks the action). 90 public / 98 manifest operations, 45 platform operations.

This prerelease is built locally for the aenv-next scaffold and is not published to npm.

## 0.10.0-aenv.10 (local aenv-next prerelease)

Breaking: an App calls the platform as itself only (its App Key). Narrowing data by the visitor's role is the App's own job; the platform no longer does it for the App.

- Removed employee delegation: `runWithRequestContext`, `runWithRequiredEmployeeContext`, `runAsApp`, `currentDataSubject` and `currentDelegation` from `@tier0/sdk-v2/data`; the `unsV2AppDataSubject` and `delegation` client options; forwarding of `X-Tier0-Delegation` and `X-Tier0-App-Data-Subject`. An App built with an older SDK that calls `runWithRequiredEmployeeContext` throws once the front door stops sending the delegation header.
- The data layer still takes the request's abort signal, through a new API that carries only that: `runWithAbortSignal(request.signal, fn)`; `runDetached(fn)` runs work that must outlive the request. Ensure, seed writes and `data.subscribe` never take a request's signal.
- Removed `restricted` from `records:subscribe` change events, the `restricted` option of `data.subscribe`, `redactRestricted` and the collection-level `CollectionChange` it produced; `SubscriptionEvent` is a `RecordChange` or a `reset`. An older SDK drops every change event without `restricted`.
- Removed the ensure hint for the retired `DATA_RULE_FIELD` conflict.
- `MQTTConfig` docs name what the platform injects today: the broker in `TIER0_MQTT_HOST` / `TIER0_MQTT_PORT` and the App's key in `TIER0_API_KEY`.
- Visitor identity is the plain `X-Tier0-Visitor` header the front door sets: `parseVisitorHeader(value, { appID? })` in `@tier0/sdk-v2/server` decodes the canonical unpadded base64url JSON (at most 8192 bytes) strictly: `ws` is a positive decimal ID without sign or leading zero, an employee has a 1–128 byte `grant` and a machine visitor an empty one, `active_role` when present is 1–128 bytes, `app_roles` has no item limit (each 1–128 bytes, the whole JSON at most 8192 bytes) and duplicates are dropped, a byte order mark, a duplicate key (in any spelling) or a lone UTF-16 surrogate is refused, and `app` must equal `TIER0_APP_ID`, throwing `VisitorError` (`VISITOR_HEADER_INVALID` / `VISITOR_CONFIGURATION_INVALID`). Removed visitor token verification: `createVisitorTokenVerifier`, `VISITOR_TOKEN_HEADER`, `VisitorTokenError`, `VerifiedVisitor`, `parseVisitorJwks`, `frontdoorKeys`, `frontdoorKeysFromDir`, `frontdoorKeysFromUrl`, `FRONTDOOR_JWKS_REFRESH_MS`, `FRONTDOOR_JWKS_MISS_REFRESH_MS` and the `TIER0_JWKS_DIR` / `TIER0_JWKS_URL` variables. Apps built with an older SDK cannot recognize visitors once the front door sends the plain header, and must be rebuilt and republished.
- Browsers no longer connect to MQTT: removed `getMqttToken`, `reportMqttFailure` and `MqttTokenResponse` from the page runtime, and the browser token source of `Tier0MQClient` (its stop-after-refusals and sleep/resume handling). The server side through the node proxy is unchanged.
- New `createChangeRelay(data, options?)` in `@tier0/sdk-v2/data`: one `data.subscribe` per server process, fanned out to browsers as an SSE `Response` for an App route, with a per-browser `filter` the App decides by the visitor's roles. The relay numbers events itself (`<epoch>.<seq>`) and hands a browser a position only once the upstream can deliver every change after it: on a cold start browsers get `reset` (`upstream-started`) when the upstream first streams. It keeps the last UNS position and reopens a failed or idle-closed upstream from it in the same epoch, so browsers miss nothing and get no reset; only a UNS `reset` starts a new epoch. A reconnect's `Last-Event-ID` is replayed from the current epoch's buffer, anything else gets `reset`. While the upstream cannot connect (429 over the subscription limit, `APP_NOT_READY`, a failure that ends `data.subscribe`) the relay's `status` is `unavailable`, `onStatus` and `logger.warn` hear it, and browsers get `event: unavailable`. Heartbeats are id-only frames that move an idle browser's position. The relay sends no `retry:` field: `openEventStream` owns reconnect timing. Browser streams end after 10 minutes so the route authenticates the reconnect. `data.subscribe` reports connections, positions and retries to the relay through an internal observer.
- Removed the App request identity verifier (`X-Tier0-App-Identity`, issued by the retired `tier0-app-gateway`): `createCloudAppRequestVerifier`, `APP_REQUEST_IDENTITY_HEADER`, `AppRequestIdentityError` and their types. `@tier0/sdk-v2/server` now only parses the visitor header.
- `openEventStream` closes its connection while the page is hidden and reconnects from the last event id (`Last-Event-ID`) as soon as it is visible again, so a background tab no longer holds a long connection to the App; `pauseWhenHidden: false` keeps the old behavior.
- `Tier0MQClient` in an App runtime uses the hosted App key's clientId: with `TIER0_APP_ID` set, the key taken from the injected `TIER0_API_KEY`, and no explicit `clientId`, `username` or `password`, the generated clientId is `<ws>&h.<TIER0_APP_ID>.<16 random [a-z0-9]>` (username stays `<ws>&open`), the only form Backend (`share/hostedappkey`, `^([1-9][0-9]{0,18})&h\.([A-Za-z0-9_-]{1,64})\.[a-z0-9]{8,32}$`) accepts for a hosted App key. Otherwise, and when `TIER0_APP_ID` is not a valid app segment, it stays `<ws>&<8 random>`. One client keeps its clientId across reconnects.
- Docs, skills and messages describe the credential the platform actually provides: the App's key is `TIER0_API_KEY` in the App's process (Preview: the preview key, deployments: the deployed key) and the SDK uses it directly, sending one `X-API-Key`. Removed the claims that the VM holds no key, that the node proxy fills it in, and that hand-written requests must send `X-Tier0-SDK: 1`. Platform proxy mode (no `TIER0_API_KEY` with `TIER0_RUNTIME` set) is unchanged in code and documented as the mode of a keyless runtime, which the platform does not use today; the `sbx_proxy_*` error codes are documented under it.
- Removed the browser trusted runtime: `@tier0/sdk-v2/runtime` (`installAppRuntime`, `getAppRuntime`, `AppRuntime`, the `Symbol.for('tier0.sdk.app-runtime.v1')` host bridge) and the host branch of `client.streams`. Its only installer was the retired `tier0-app-gateway`. `client.streams` (requests, messages, capabilities) now always goes through the client's own HTTP configuration and key, on the server; browsers reach the platform only through the App's own server routes. The connect request's `appId` is `getCurrentAppId()` (`TIER0_APP_ID`). The artifact and native NATS acceptance scripts use a keyed server client.
- Docs name the route allowlist Backend now enforces for an App's key on every entry (decision 13: no more legacy / observe switch): `/openapi/v2/uns/**`, `assets/**`, `notifications/send`, `platform/getMembers`, `apps/access-members/list`, `info`; anything else answers 403 `hosted_app_key_route_forbidden`.
- Every contract input is synchronized from Backend `b6347c688615b0c277ebb696e851f3d1e3115652` (`app-data-rule-retirement/1`): `CloudAppDataGrant.dataRule`, `ruleContractVersion`, the `CloudAppDataRule*` schemas, `CloudAppCreateCapability` / `createCapability`, `CloudRecordChangeEvent.restricted` and the hosted App platform permission `notifications.read` are gone. The Source/Stream, capability and Stream request pins move to the same commit. Other Backend contract changes that come with it: `client.notifications.list` (`POST /openapi/v2/notifications/list`, not forwarded by the node proxy) and `recipientUserId` / `recipientName` on notification send/get responses; the raw operation `sourceOpcuaEndpoints` (OPC UA endpoint security discovery, builder-side, kept out of `client.source` like `edgeNodesList`); `sourceProbe` `mode` (`connection` / `data`) with `SourceCheckResult`, and `connectionCheck` / `dataCheck` on Source views; Stream run `delivery` / `diagnostics` and observation `diagnostics`; `reason` / `path` on `CloudStreamRunError`; `alias` / `resources` on `StreamSourceBinding`; reworded descriptions. 92 public / 106 manifest operations, 45 platform operations.

Also in this prerelease (merged from base before it was versioned):


- Merge the base 0.9.11 release candidate (base `593042c`) into the aenv-next line: per-request `apiKeyProvider`, explicit credential sources that never fall back to another source or `TIER0_API_KEY`, a single `X-API-Key` header (no `Authorization: Bearer`), Data clients bound to the host and static key resolved at creation, and MQTT `connect()` rejecting an explicitly undefined password.
- Platform proxy mode is unchanged in code: a client without an `apiKey` value, `getApiKey` or `apiKeyProvider` sends no credential, only `X-Tier0-SDK: 1`, and keeps the proxy retries. `createDataClient` fixes `apiKey` from the environment at creation, which is `undefined` in the platform, so it stays in proxy mode. Outside the platform the base credential rules apply as is.
- Source/Stream public operations and their schemas are synchronized from Backend `727c6395a` (as on base) over the aenv-next contract pin `8780ce2d6`; every other operation keeps the aenv-next pin. 91 public / 105 manifest operations. (Superseded in this prerelease by the full sync to `b6347c688` above.)

This prerelease is built locally for the aenv-next scaffold and is not published to npm.

## 0.10.0-aenv.9 (local aenv-next prerelease)

- Merge the base MQTT and data fixes of 2026-11-05 (base `d0276cf`) into the aenv-next line. MQTT: callbacks are bound to the connection generation, mqtt.js resubscription is off and every topic checks its SUBACK grant (MQTT 3.1.1 and 5), connection settings are preflighted and rolled back on failure, settings cannot change while a client exists, and a failed first connect drops the subscriptions it registered. aenv-next keeps its own reconnect model: the SDK reconnects itself, a browser fetches a fresh token on every reconnect, new subscriptions and publishes wait for the reconnect instead of failing, and `disconnect()` also rejects the waiting calls.
- `runWithRequiredEmployeeContext` accepts either `X-Tier0-App-Data-Subject` (base) or `X-Tier0-Delegation` (aenv-next employee identity); whichever is present must be well formed.
- Notifications are sent without `mode`; the platform derives test or live from the App Key's runtime (session sandboxes carry the preview key).

This prerelease is built locally for the aenv-next scaffold and is not published to npm.

## 0.10.0-aenv.8 (local aenv-next prerelease)

- Visitor tokens on AENV Apps: when `TIER0_JWKS_DIR` does not exist (published Apps have no guest agent writing it), `createVisitorTokenVerifier()` fetches the front door keys from `TIER0_JWKS_URL` (`https://<app>.<apps domain>/__tier0/jwks.json`, set by the platform) with the new `frontdoorKeysFromUrl()`: refreshed every 60 s, early when a token names an unknown `kid` (at most every 10 s), the last good set kept when a fetch fails, `dev-` kids never trusted. Until the first fetch lands every token is refused; `ready()` waits for it. `frontdoorKeys()` is the new default source; `frontdoorKeysFromDir()` is unchanged.

This prerelease is built locally for the aenv-next scaffold and is not published to npm.

## 0.10.0-aenv.7 (local aenv-next prerelease)

- Merge base 0.9.9 and 0.9.10 into the aenv-next line (`0.10.0-aenv.6` + base `0.9.10`): the Personal key local connection guide, non-JSON gateway error diagnostics, App versus workspace credential query guidance and the Namespace trash / delete / restore wording. The node-proxy credential model is unchanged: there is no `TIER0_API_KEY` in the VM, every platform request carries `X-Tier0-SDK: 1`, and the proxy error reference stays.
- Pin every contract input to Backend `8780ce2d6c07b6afee96409795c098e330c214dd` (the merge of base `2f79a4f87` into aenv-next).
- The Backend's new `sourceResourceCatalog`, `sourceResourceRead` and `sourceResourceScan` stay in the raw operation table only, like `edgeNodesList` and `sourceDocumentStateUpdate`; `client.source` does not expose them (base 0.9.10 does not either). The four contract baselines are re-pinned to the current contract: operation counts 87/100, the Namespace digest (its only reachable change is three more ensure schema-note reasons) and the facade membership test. `metadataPurge` now also accepts `directory` / `topic` (Backend `ae62b5e18`), so the type test no longer rejects a directory purge; the Skills still document collection purges only.

This prerelease is built locally for the aenv-next scaffold and is not published to npm.

## 0.10.0-aenv.6 (local aenv-next prerelease)

- Merge base 0.9.8 into the aenv-next line: `metadataPurge`, `directoryPath` App collection declarations and the shorter Source lifecycle, on top of aenv-next's node-proxy credential model (no `TIER0_API_KEY` in the VM).
- Pin every contract input to Backend `c63783eb485e99167fec3a1c6ffb034ada4170e1` (the merge of base into aenv-next). The App stream policy operations require `uns.write` there.
- `members.listApp` is available through the node proxy again (the proxy allowlists `/openapi/v2/apps/access-members/list`); the Backend authorizes a hosted App key by the App's `platform.users.read` like `platform/getMembers` and omits `email` from the response.
- The Backend's `edgeNodesList` and `sourceDocumentStateUpdate` stay in the raw operation table only; neither `client.source` nor `client.uns` exposes them. The four contract baseline tests (operation counts 84/97, the Namespace digest and the Source facade membership) are re-pinned to the current contract.

This prerelease is built locally for the aenv-next scaffold and is not published to npm.

## 0.9.11 (unreleased candidate)

- Send the single authentication header required by the Cloud Gateway; whoami uses `X-API-Key`.
- Support asynchronous per-request credential providers without sharing credentials or falling back after provider failure.
- Include the native Source/Stream contract updates from the Cloud migration target.

- Select the HTTP credential source by explicit configuration presence. Missing explicit credentials no longer fall back to another source or `TIER0_API_KEY`; omit all credential properties to retain the environment default.
- Preserve non-enumerable explicit credentials and delegation settings in client configuration snapshots.
- Bind each high-level Data client to the host and static credential resolved at creation, and reject dynamic credential callbacks so cached bootstrap and subscriptions cannot switch principals.
- Reject an explicitly undefined MQTT connect-time password instead of silently reusing a saved or environment credential.

## 0.9.10 (2026-11-04)

- Add a local connection guide for Personal keys, explicit OpenAPI gateway configuration and reading existing collections without a platform App.
- Explain non-JSON route, authentication, permission and service errors without exposing credentials or changing error types, execution/retry semantics or request destinations.
- Align Namespace trash, delete and restore guidance: retained data remains readable, archived targets reject writes, and the legacy record restoration limit does not apply to current collection archive / restore.

## 0.9.9 (2026-11-04)

- Clarify workspace Agent/Personal versus App credential query permissions. Keep `namespace()` on OpenAPI; document `dataAppContext` followed by `recordFind` for App keys, with a typed example and 403 troubleshooting. No runtime authorization changes.

- Add `client.uns.metadataPurge` for explicit archived Collection IDs. Preserve the asynchronous `accepted` / `jobId` receipt; use `jobs` to inspect completion and per-item results. Preview remains optional.
- Document Collection deletion with retained records/samples and configuration references, followed by restore or permanent deletion.
- Preserve App collection directories and Source lifecycle behavior, and pin the combined contract to Backend commit `064cdcdb688b18fb73295ac986380d84daa08188`.

## 0.9.8 (2026-11-02)

- Add `directoryPath` to App collection declarations and preserve it through compilation and first-use ensure. New collections use actual business directories; existing aliases retain their location.
- Validate and freeze paths, and document known ISA-95 scopes, shared ancestors, and App/module directories within those scopes without forcing five levels.
- Preserve the Source lifecycle changes from the unpublished 0.9.7 candidate and pin their combined contract with App collection directories to Backend commit `5c77d6f21e6332cb09e3212df9203eb01bf7f129`.

## 0.9.7 (unreleased candidate)

- Remove Cloud Source `state.update`, enable/disable capabilities, `desiredState`, and enable-related MQTT authorization confirmation. A Source can be used after creation; deleting it stops subsequent use.
- Keep actual Source runtime and health observations, revision checks, credential authorization, and confirmation for referenced connection changes or deletion. Name/description-only edits do not need impact confirmation.
- Use Unicode character limits of 63 for Source names and 512 for descriptions.
- Document direct deletion of active Streams and update Source/Stream examples to the shorter lifecycle.

The Source lifecycle contract is pinned to Backend commit `87a2bc316fbae69448e58dd66e38450c744793b5`. This candidate is not published to npm; install the verified tarball for integration testing against that backend contract.
