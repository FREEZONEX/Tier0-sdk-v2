---
name: tier0-sdk-v2-controls
description: Discover, describe and invoke Tier0 Cloud Control contracts from TypeScript/JavaScript, preserving execution and idempotency semantics.
---

Use `client.controls.discover()` and `client.controls.use({ code })`. Read the selected Control's description, inputSchema, sideEffect and idempotency requirements before constructing an invocation.

Invoke with a caller-owned idempotency key when required. The SDK does not invent a key or automatically retry an execution. `ControlResultUnknownError` means execution may have occurred; reconcile the run before intentional replay and preserve the original business key.

Workspace capability discovery does not authorize every individual control. App data read/write permissions do not imply Control execution permissions. Use the public Control contract rather than reaching internal Core endpoints. See [configuration and errors](../../README.md).
