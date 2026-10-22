---
name: tier0-sdk-v2-mq
description: Implement MQTT WebSocket subscriptions or publishing for Tier0 Cloud realtime data with @tier0/sdk-v2/mq.
---

Import `Tier0MQClient` and `toWebSocketUrl` from `@tier0/sdk-v2/mq`. Resolve the broker using `client.system.info()` or explicit platform configuration; do not build malformed URLs by prefixing `wss://` to a `tcp://` address.

Use scoped MQTT credentials with explicit `clientId`, `username`, `password`. `client.mqttAuth.create({ name })` returns the password only on creation. A workspace-encoded API key can derive server-side MQTT identity; invalid keys are rejected instead of falling back to Enterprise identity.

Subscribe/publish only to the actual authorized platform topics. Import the MQTT subpath only where needed. Keep platform API keys out of browser bundles; provide appropriately scoped MQTT credentials through the application's server when browser MQTT is needed.

MQTT reconnect and QoS can redeliver messages; consumers that perform business side effects should deduplicate. See [MQTT example](../../README.md).
