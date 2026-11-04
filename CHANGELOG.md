# Changelog

## 0.10.0-aenv.5 (local aenv-next prerelease)

- Merge base 0.9.8 into the aenv-next line: `metadataPurge`, `directoryPath` App collection declarations and the shorter Source lifecycle, on top of aenv-next's node-proxy credential model (no `TIER0_API_KEY` in the VM).
- Pin every contract input to Backend `c63783eb485e99167fec3a1c6ffb034ada4170e1` (the merge of base into aenv-next). The App stream policy operations require `uns.write` there.
- `members.listApp` stays unavailable through the node proxy.
- Known gap: the Backend's `edgeNodesList` and `sourceDocumentStateUpdate` are not exposed yet, so four contract baseline tests fail until that is decided.

This prerelease is built locally for the aenv-next scaffold and is not published to npm.

## 0.9.8 (unreleased candidate)

- Add `client.uns.metadataPurge` for explicit archived Collection IDs. Preserve the asynchronous `accepted` / `jobId` receipt; use `jobs` to inspect completion and per-item results. Preview remains optional.
- Document Collection deletion with retained records/samples and configuration references, followed by restore or permanent deletion.
- Add `directoryPath` to App collection declarations and preserve it through compilation and first-use ensure. New collections use actual business directories; existing aliases retain their location.
- Validate and freeze paths, and document known ISA-95 scopes, shared ancestors, and App/module directories within those scopes without forcing five levels.
- Preserve the Source lifecycle changes from 0.9.7 and pin their combined contract with App collection directories and permanent deletion to Backend commit `064cdcdb688b18fb73295ac986380d84daa08188`.

This candidate is not published to npm; install the verified tarball for integration testing against that backend contract.

## 0.9.7 (unreleased candidate)

- Remove Cloud Source `state.update`, enable/disable capabilities, `desiredState`, and enable-related MQTT authorization confirmation. A Source can be used after creation; deleting it stops subsequent use.
- Keep actual Source runtime and health observations, revision checks, credential authorization, and confirmation for referenced connection changes or deletion. Name/description-only edits do not need impact confirmation.
- Use Unicode character limits of 63 for Source names and 512 for descriptions.
- Document direct deletion of active Streams and update Source/Stream examples to the shorter lifecycle.

The Source lifecycle contract is pinned to Backend commit `87a2bc316fbae69448e58dd66e38450c744793b5`. This candidate is not published to npm; install the verified tarball for integration testing against that backend contract.
