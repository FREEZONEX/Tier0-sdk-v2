---
name: tier0-sdk-v2
description: Build or migrate TypeScript/JavaScript integrations with the Tier0 Cloud new-architecture SDK, including package setup and cross-domain App integration. Use @tier0/sdk-v2, not the legacy @tier0/sdk package.
---

Use `@tier0/sdk-v2` and `createClient({ apiHost, apiKey })`, or server-injected `TIER0_API_HOST` / `TIER0_API_KEY`. The current package version is 0.1.0; verify it is published or install a locally built tarball. Keep an exact dependency for generated Apps.

Create independent instances for distinct credentials. App keys remain on the server. Employee delegation uses a fresh instance per incoming request and the trusted `unsV2AppDataSubject`; the App request identity assertion has a different audience and is not interchangeable.

Domain skills are independently discoverable; they do not require reading this file first:

- [UNS](../tier0-sdk-v2-uns/SKILL.md): records, collections, samples, sources, streams.
- [Files](../tier0-sdk-v2-files/SKILL.md): uploads, attachments, avatars, imported/exported or generated files, even when the user does not mention an SDK.
- [Notifications](../tier0-sdk-v2-notifications/SKILL.md): inbox and device reminders.
- [MQTT](../tier0-sdk-v2-mq/SKILL.md): realtime topics and messaging.
- [Members](../tier0-sdk-v2-members/SKILL.md): workspace member lookup and App-member limitations.
- [System](../tier0-sdk-v2-system/SKILL.md): key identity, platform info and capabilities.
- [Controls](../tier0-sdk-v2-controls/SKILL.md): discover and invoke control contracts.
- [Agent](../tier0-sdk-v2-agent/SKILL.md): jobs, results, cards and analyses.

See the [package guide](../../README.md) for framework adapters and complete examples. Generated methods reflect a pinned Backend source revision, not proof that every feature is deployed or allowed for the current key.
