---
name: tier0-sdk-v2-streams
description: "Tier0 App/Stream requests and live business messages: client.streams.requests describe/invoke/discover, client.streams.messages publish/subscribe, trusted App runtime bootstrap and disposable subscriptions. Use for Stream v3 interactions; UNS history, device MQTT and persisted notifications have their own Skills."
---

# App / Stream Interactions

Read the [root Skill](../SKILL.md) first. These APIs require an artifact built from the unified SDK implementation: pin its commit and SHA-256 until the corresponding version is published.

## Select the interaction

- A public request code with an input/output contract: `client.streams.requests.use({ code })`. Use `describe()` to inspect it; use `client.streams.requests.discover()` to find visible contracts.
- App request capability discovery: `client.streams.capabilities.discover()`. It validates request/invoke contracts independently of `client.capabilities.discover()`, which covers Namespace/Source/Stream management. Neither grants access or requires a mandatory preflight before every call.
- A live logical business topic: `client.streams.messages.use({ topic })`. Use `publish(payload)` or `subscribe(handler)` and dispose the returned subscription.
- Persisted business data belongs to UNS, device-topic MQTT belongs to the MQ Skill, and user-facing notification records belong to the Notifications Skill. Live Stream messages have no retention or replay.

Import `client` or `createClient` from `@tier0/sdk-v2`. The same client exposes `uns`, `source`, `stream`, `capabilities`, `files` and `notifications`. The singular `stream` manages documents, programs and runs; plural `streams` performs App requests and live messaging. MQTT stays in the separate `/mq` entry.

## Trusted App bootstrap

The SWE host installs `globalThis[Symbol.for('tier0.sdk.app-runtime.v1')]` before the App script. The SDK detects it automatically; App business code must not install a replacement provider or resolve credentials itself. The host's provider returns a `Response` for its authenticated request bridge.

Browser App code knows only public request codes, logical topics and business payloads. Do not add broker URLs, physical subjects, API keys, JWTs, nkey seeds, workspace/principal headers or message identity claims to App configuration. `@tier0/sdk-v2/runtime` is a trusted host integration entry point, not App setup.

For a standalone Node service, the deployment supplies its existing HTTP credential and real App context. Call `createClient()` without literals; never put these server credentials in a browser bundle.

## Public caller

```ts
import { createClient, type StreamMessageError } from '@tier0/sdk-v2';

export async function openOrders(
  reportError: (error: StreamMessageError) => void,
  renderOrderUpdate: (order: { orderId: string }) => void,
) {
  const sdk = createClient(); // automatically uses the trusted App runtime
  const removeErrorHandler = sdk.streams.messages.onError(reportError);
  const subscription = await sdk.streams.messages.use<{ orderId: string }>({ topic: 'orders/accepted' })
    .subscribe(message => renderOrderUpdate(message.payload));
  const request = sdk.streams.requests.use<{ orderId: string }, { accepted: boolean }>({ code: 'orders.approve' });
  return {
    describe: () => request.describe(),
    approve: (orderId: string, savedIntentId: string) => request.invoke({ orderId }, { idempotencyKey: savedIntentId }),
    async dispose() {
      await subscription.dispose();
      removeErrorHandler();
      await sdk.dispose();
    },
  };
}
```

Persist one caller-owned idempotency key per business intent. A deliberate reconciliation/replay reuses that key. The SDK never generates a request idempotency key, selects deployment versions or retries a write. An unknown result means execution may have happened; reconcile the returned run metadata before any further business action.

## Live message lifecycle

Messages use a versioned `{ version, messageId, correlationId?, payload }` envelope. Caller-supplied identity in a payload is business data, not authenticated publisher metadata; authorized broker subjects establish identity internally.

The SDK uses native Core NATS over WSS, loaded only when messaging starts. Messages require a browser with WebSocket or Node.js 22+; HTTP-only clients remain usable on Node.js 20.19+. Each initial connection, reconnect and renewal gets a new in-memory user key and a public-key-bound JWT. The old socket closes and its private key is wiped before replacement. No private key leaves the SDK. A successful publish means broker flush, not receiver acknowledgement.

Register `messages.onError` (or subscription `onError`) to handle asynchronous broker, decoding and handler failures. After an established session disconnects, publish fails immediately: no offline buffering, write retry or message replay. Credential refresh and reconnection restore subscriptions only. Dispose subscriptions and the owned client when the view/service stops.

## Stream-side code

Current Cloud Source/Stream documents omit `sdkVersion` and `configVersion` selectors. When the coordinated request/message runtime is deployed, request registration uses `api.stream.onRequest({ id, request }, handler)`; business-message consumers use `api.stream.messages.subscribe({ id, topic, inputSchema }, handler)`. Declare each outgoing logical topic with `api.stream.messages.use({ topic, access: 'publish' })` before calling `api.stream.messages.publish({ topic, payload })`. The current `api.stream.onMessage` remains a Source-event handler, not a business-message subscription.

Use the [Stream management Skill](../tier0-sdk-v2-stream/SKILL.md) for creating and deploying a program. Historical documents may be displayed as immutable history; do not submit them as current write/validation fixtures or infer that current deployments provide the new message runtime.
