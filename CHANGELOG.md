# Changelog

## 0.10.0-aenv.10 (local aenv-next prerelease)

Breaking: an App calls the platform as itself only (its App Key). Narrowing data by the visitor's role is the App's own job; the platform no longer does it for the App.

- Removed employee delegation: `runWithRequestContext`, `runWithRequiredEmployeeContext`, `runAsApp`, `currentDataSubject` and `currentDelegation` from `@tier0/sdk-v2/data`; the `unsV2AppDataSubject` and `delegation` client options; forwarding of `X-Tier0-Delegation` and `X-Tier0-App-Data-Subject`. An App built with an older SDK that calls `runWithRequiredEmployeeContext` throws once the front door stops sending the delegation header.
- The data layer still takes the request's abort signal, through a new API that carries only that: `runWithAbortSignal(request.signal, fn)`; `runDetached(fn)` runs work that must outlive the request. Ensure, seed writes and `data.subscribe` never take a request's signal.
- Removed `restricted` from `records:subscribe` change events, the `restricted` option of `data.subscribe`, `redactRestricted` and the collection-level `CollectionChange` it produced; `SubscriptionEvent` is a `RecordChange` or a `reset`. An older SDK drops every change event without `restricted`.
- Removed the ensure hint for the retired `DATA_RULE_FIELD` conflict.
- Visitor identity is the plain `X-Tier0-Visitor` header the front door sets: `parseVisitorHeader(value, { appID? })` in `@tier0/sdk-v2/server` decodes the canonical unpadded base64url JSON (at most 8192 bytes) strictly: `ws` is a positive decimal ID without sign or leading zero, an employee has a 1–128 byte `grant` and a machine visitor an empty one, `active_role` when present is 1–128 bytes, duplicate `app_roles` are dropped, and `app` must equal `TIER0_APP_ID`, throwing `VisitorError` (`VISITOR_HEADER_INVALID` / `VISITOR_CONFIGURATION_INVALID`). Removed visitor token verification: `createVisitorTokenVerifier`, `VISITOR_TOKEN_HEADER`, `VisitorTokenError`, `VerifiedVisitor`, `parseVisitorJwks`, `frontdoorKeys`, `frontdoorKeysFromDir`, `frontdoorKeysFromUrl`, `FRONTDOOR_JWKS_REFRESH_MS`, `FRONTDOOR_JWKS_MISS_REFRESH_MS` and the `TIER0_JWKS_DIR` / `TIER0_JWKS_URL` variables. Apps built with an older SDK cannot recognize visitors once the front door sends the plain header, and must be rebuilt and republished.
- Browsers no longer connect to MQTT: removed `getMqttToken`, `reportMqttFailure` and `MqttTokenResponse` from the page runtime, and the browser token source of `Tier0MQClient` (its stop-after-refusals and sleep/resume handling). The server side through the node proxy is unchanged.
- New `createChangeRelay(data, options?)` in `@tier0/sdk-v2/data`: one `data.subscribe` per server process, fanned out to browsers as an SSE `Response` for an App route, with a per-browser `filter` the App decides by the visitor's roles. The relay numbers events itself (`<epoch>.<seq>`), replays from `Last-Event-ID` within the current session and answers anything else with `reset`; browser streams end after 10 minutes so the route authenticates the reconnect.
- Removed the App request identity verifier (`X-Tier0-App-Identity`, issued by the retired `tier0-app-gateway`): `createCloudAppRequestVerifier`, `APP_REQUEST_IDENTITY_HEADER`, `AppRequestIdentityError` and their types. `@tier0/sdk-v2/server` now only parses the visitor header.
- `openEventStream` closes its connection while the page is hidden and reconnects from the last event id (`Last-Event-ID`) as soon as it is visible again, so a background tab no longer holds a long connection to the App; `pauseWhenHidden: false` keeps the old behavior.
- Every contract input is synchronized from Backend `59cc52688ce0144effb831eceeebb31d5a374efe` (`app-data-rule-retirement/1`): `CloudAppDataGrant.dataRule`, `ruleContractVersion`, the `CloudAppDataRule*` schemas, `CloudAppCreateCapability` / `createCapability`, `CloudRecordChangeEvent.restricted` and the hosted App platform permission `notifications.read` are gone. The Source/Stream, capability and Stream request pins move to the same commit. Other Backend contract changes that come with it: `client.notifications.list` (`POST /openapi/v2/notifications/list`, not forwarded by the node proxy) and `recipientUserId` / `recipientName` on notification send/get responses; the raw operation `sourceOpcuaEndpoints` (OPC UA endpoint security discovery, builder-side, kept out of `client.source` like `edgeNodesList`); `sourceProbe` `mode` (`connection` / `data`) with `SourceCheckResult`, and `connectionCheck` / `dataCheck` on Source views; Stream run `delivery` / `diagnostics` and observation `diagnostics`; `reason` / `path` on `CloudStreamRunError`; `alias` / `resources` on `StreamSourceBinding`; reworded descriptions. 92 public / 106 manifest operations, 45 platform operations.

Also in this prerelease (merged from base before it was versioned):


- Merge the base 0.9.11 release candidate (base `593042c`) into the aenv-next line: per-request `apiKeyProvider`, explicit credential sources that never fall back to another source or `TIER0_API_KEY`, a single `X-API-Key` header (no `Authorization: Bearer`), Data clients bound to the host and static key resolved at creation, and MQTT `connect()` rejecting an explicitly undefined password.
- Platform proxy mode is unchanged: a client without an `apiKey` value, `getApiKey` or `apiKeyProvider` sends no credential, only `X-Tier0-SDK: 1`, and keeps the proxy retries. `createDataClient` fixes `apiKey` from the environment at creation, which is `undefined` in the platform, so it stays in proxy mode. Outside the platform the base credential rules apply as is.
- Source/Stream public operations and their schemas are synchronized from Backend `727c6395a` (as on base) over the aenv-next contract pin `8780ce2d6`; every other operation keeps the aenv-next pin. 91 public / 105 manifest operations. (Superseded in this prerelease by the full sync to `59cc52688` above.)

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
