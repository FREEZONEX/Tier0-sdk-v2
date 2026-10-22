---
name: tier0-sdk-v2-system
description: Inspect Tier0 Cloud SDK connection identity, platform info and capability readiness; integrate trusted App request identity verification.
---

Use `client.system.whoami()`, `client.system.info()` and `client.capabilities.discover()`. `whoami` identifies the API credential, not automatically the current browser user. A capability's release flag or method presence is not runtime readiness or a resource-specific grant.

The server-only `@tier0/sdk-v2/server` entry provides `createCloudAppRequestVerifier`. Configure trusted public keys, App and Workspace from server configuration; verify original request body bytes and request URI. Do not trust caller-supplied identity headers without signature verification.

The App request identity assertion (`tier0-app-runtime`) and UNS employee data delegation (`tier0-uns-data`) are different contracts. Do not forward one as the other. No `/gw/reload` or old project-context helper is exposed. See [configuration](../../README.md).
