---
name: tier0-sdk-v2-uns
description: Implement Tier0 Cloud UNS v2 collection and record CRUD, sample/history queries, data discovery, Source or Stream integration in TypeScript/JavaScript Apps.
---

Import `createClient` from `@tier0/sdk-v2`; keep the platform key on the server. Use `client.uns`, not `/openapi/v1/uns/*` or the retired Flow API.

For App data, call `client.uns.dataAppContext({})` to inspect its authorized collections. Resolve the real collection ID from platform context; knowing a collection ID does not grant access. Workspace management methods are not automatically available to App keys.

```ts
const response = await client.uns.recordFind({ collectionId, limit: 20 });
const result = response.data;
```

UNS responses retain `code`, `msg`, `requestId` and `data`. Use the generated request types for filters, transactions, samples and Source/Stream operations instead of inventing field names. Support `number | bigint` identifiers and `UnsV2RawNumber` values without coercing them through Number or JSON.stringify.

Use explicit caller-owned idempotency keys where the operation supports them. Never automatically replay a write on timeout or `UnsV2OutcomeUnknownError`; first reconcile the request/job result. Optional second argument `{ signal }` cancels the client request, not confirmed server-side effects.

App policies, credentials and other Core-only operations are excluded. Do not work around that boundary using an undocumented route. See [usage and current limits](../../README.md).
