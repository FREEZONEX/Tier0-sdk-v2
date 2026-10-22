---
name: tier0-sdk-v2-notifications
description: Send or inspect Tier0 Cloud App notifications, inbox messages, Web/Desktop reminders and Mobile push using @tier0/sdk-v2.
---

Use `client.notifications.send(body)` and `get({ messageId })` on a server-side client. The caller owns the business idempotency key; do not create a new key to retry an uncertain send.

`channels` accepts only `web` and `mobile`. Omitted means both; `web` includes Desktop; an explicit single channel stays single; `[]` means inbox only. Do not generate Desktop-only channels.

For an App sender, use `{ type: 'app', id: getCurrentAppId() }` from `@tier0/sdk-v2`. The runtime must supply the real UUID in `APP_ID`. No project or Folder context is required or injected by this SDK. Sender metadata is presentation information, never authorization.

The notification response is direct JSON, not a `data` envelope. Errors preserve `errorCode` and HTTP status. Use [workspace members](../tier0-sdk-v2-members/SKILL.md) only when workspace recipients are intended; it does not identify who may access the App. See [send examples](../../README.md).
