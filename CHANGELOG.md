# Changelog

## Unreleased

- Select the HTTP credential source by explicit configuration presence. Missing explicit credentials no longer fall back to another source or `TIER0_API_KEY`; omit all credential properties to retain the environment default.
- Bind each high-level Data client to the host and static credential resolved at creation, and reject dynamic credential callbacks so cached bootstrap and subscriptions cannot switch principals.

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
