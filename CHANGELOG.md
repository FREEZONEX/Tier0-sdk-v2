# Changelog

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
