---
name: tier0-sdk-v2-streams
description: "Tier0 App/Stream requests and live business messages: client.streams.requests describe/invoke/discover, client.streams.messages publish/subscribe on a server client with its own key, and disposable subscriptions. Use for Stream v3 interactions; UNS history, device MQTT and persisted notifications have their own Skills."
---

# App / Stream Interactions

Read the [root Skill](../SKILL.md) first.

**In a Tier0 App's server code** the App's key (`TIER0_API_KEY`) can use both. Stream requests and messages are fixed capabilities of every App (`stream.requests.read` / `invoke` / `write`, `stream.messages.publish` / `subscribe`), not configured per App and not approved by an admin. They are still bounded by the workspace plan (a plan without Stream refuses them) and, for requests, by the Stream request grants: the request code must be granted to this App. Message topics come from published Stream manifests: the App may subscribe to a topic a published Stream declares with `api.stream.messages.use({ topic, access: 'publish' })`, and publish to a topic an active Stream subscribes to. There is no per-App topic list. These APIs require an artifact built from the unified SDK implementation: pin its commit and SHA-256 until the corresponding version is published.

Builder configures request grants using the management operations exposed by the current MCP contract: `/openapi/v2/uns/stream-requests/grants/get` and `/openapi/v2/uns/stream-requests/grants/set`, and `/openapi/v2/uns/app-stream-access/list`. Use the injected system key's current `stream.requests.manage` permission; its bound App is build context, so it may manage target Apps in the same workspace. Granted actions cannot exceed the manager's current permissions. Read the grant snapshot before updating or revoking, and reconcile state after conflicts or unknown outcomes. App runtime keys cannot manage grants. These management operations are separate from `client.streams` execution; do not invent a `client.uns` grant method.

## Select the interaction

- A public request code with an input/output contract: `client.streams.requests.use({ code })`. Use `describe()` to inspect it; use `client.streams.requests.discover()` to find visible contracts.
- App request capability discovery: `client.streams.capabilities.discover()`. It validates request/invoke contracts independently of `client.capabilities.discover()`, which covers Namespace/Source/Stream management. Neither grants access or requires a mandatory preflight before every call.
- A live logical business topic: `client.streams.messages.use({ topic })`. Use `publish(payload)` or `subscribe(handler)` and dispose the returned subscription.
- Persisted business data belongs to UNS, device-topic MQTT belongs to the MQ Skill, and user-facing notification records belong to the Notifications Skill. Live Stream messages have no retention or replay.

Import `client` or `createClient` from `@tier0/sdk-v2`. The same client exposes `uns`, `source`, `stream`, `capabilities`, `files` and `notifications`. The singular `stream` manages documents, programs and runs; plural `streams` performs App requests and live messaging. MQTT stays in the separate `/mq` entry.

## Server only

Use `client.streams` from server code with a client that holds a key: `createClient()` reads `TIER0_API_HOST` / `TIER0_API_KEY`, or pass `apiHost` / `apiKey`. Never put that key in a browser bundle. Browser code does not call the platform directly; it calls the App's own server routes, which use `client.streams`. There is no browser host bridge.

Callers know only public request codes, logical topics and business payloads. Do not add broker URLs, physical subjects, JWTs, nkey seeds, workspace/principal headers or message identity claims to configuration; the SDK obtains a short-lived broker ticket per connection.

## Public caller

```ts
import { createClient, type StreamMessageError } from '@tier0/sdk-v2';

export async function openOrders(
  reportError: (error: StreamMessageError) => void,
  onOrderUpdate: (order: { orderId: string }) => void,
) {
  const sdk = createClient(); // server: TIER0_API_HOST / TIER0_API_KEY
  const removeErrorHandler = sdk.streams.messages.onError(reportError);
  const subscription = await sdk.streams.messages.use<{ orderId: string }>({ topic: 'orders/accepted' })
    .subscribe(message => onOrderUpdate(message.payload));
  const request = sdk.streams.requests.use<{ orderId: string }, { accepted: boolean }>({ code: 'orders.approve' });
  return {
    describe: () => request.describe(),
    approve: (orderId: string) => request.invoke({ orderId }),
    async dispose() {
      await subscription.dispose();
      removeErrorHandler();
      await sdk.dispose();
    },
  };
}
```

Use a known published request code; discover it if unknown rather than guessing it from the handler ID. Ordinary requests on a Backend with the simplified request contract need only `invoke(input)`. Each call is independent and the platform starts the handler once, without automatic business retries. Optional `idempotencyKey` deduplicates an intentional retransmission of the same invocation: reuse both its key and input. Business idempotency, retries and compensation belong in business code. Existing releases keep their original contracts, including a required key when declared. The SDK never invents a key, selects deployment versions or retries a request. An unknown result means execution may have happened; use the returned run metadata when deciding recovery.

## Live message lifecycle

Messages use a versioned `{ version, messageId, correlationId?, payload }` envelope. Caller-supplied identity in a payload is business data, not authenticated publisher metadata; authorized broker subjects establish identity internally.

The SDK uses native Core NATS over WSS, loaded only when messaging starts. Messages require Node.js 22+ (WebSocket); HTTP-only clients remain usable on Node.js 20.19+. Each initial connection, reconnect and renewal gets a new in-memory user key and a public-key-bound JWT. The old socket closes and its private key is wiped before replacement. No private key leaves the SDK. A successful publish means broker flush, not receiver acknowledgement.

Register `messages.onError` (or subscription `onError`) to handle asynchronous broker, decoding and handler failures. After an established session disconnects, publish fails immediately: no offline buffering, write retry or message replay. Credential refresh and reconnection restore subscriptions only. Dispose subscriptions and the owned client when the service stops.

## Stream-side code

Current Cloud Source/Stream documents omit `sdkVersion` and `configVersion` selectors. On a Backend with the simplified request contract, ordinary request registration needs only an ID and handler; timeout comes from the program's `script.timeoutMs`. No business side-effect classification, idempotency policy, input/output schema or contract version is required:

```js
module.exports = api => {
  api.stream.onRequest({ id: 'echo' }, async ctx => {
    return ctx.input;
  });
};
```

Validate business input, catch ordinary call failures, retry or compensate in the handler as needed. Platform authorization, credential and resource boundaries, execution limits and run receipts still apply. A program returning upstream data does not persist it; write explicitly to a declared Collection when persistence is required.

Timers add `intervalMs`; Source-event `onMessage` adds `source` / `resourceRefs` and protocol acquisition options; HTTP inbound `onRequest` adds `source` / `method` / `path`. Business-message consumers use `api.stream.messages.subscribe({ id, topic, inputSchema }, handler)`. Declare each outgoing logical topic with `api.stream.messages.use({ topic, access: 'publish' })` before calling `api.stream.messages.publish({ topic, payload })`. `api.stream.onMessage` is a Source-event handler, not a business-message subscription.

Use the [Stream management Skill](../tier0-sdk-v2-stream/SKILL.md) for creating and deploying a program. Historical documents may be displayed as immutable history; do not submit them as current write/validation fixtures or infer that current deployments provide the new message runtime.
