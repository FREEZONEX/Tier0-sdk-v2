---
name: tier0-sdk-v2-agent
description: Integrate Tier0 Cloud agent jobs, job runs, analyses, cards, library entries, relations and results using @tier0/sdk-v2.
---

Use the generated `client.agent` groups: `analyses`, `canvases`, `cards`, `jobs`, `jobRuns`, `library`, `nodes`, `relations`, `results`. Request and response types come from the pinned public Backend contract. Ordinary v1 envelopes are unwrapped automatically; HTTP 200 business failures throw.

Treat creation, dispatch, triggering, editing and deletion as mutations. Do not automatically retry an uncertain mutation or silently run a job as part of a read/list request. Preserve caller intent, resource version fields and idempotency fields defined by that operation.

Use the generated types to determine required inputs instead of inferring them from an internal service or frontend API. See the [package guide](../../README.md).
