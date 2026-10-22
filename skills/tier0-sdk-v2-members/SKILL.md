---
name: tier0-sdk-v2-members
description: Implement Tier0 Cloud workspace member lookup or assess App member-selection requirements with @tier0/sdk-v2.
---

The current public method is `client.members.listWorkspace(body?)`. It returns the unwrapped workspace member response. Use it for workspace-wide member selection only.

The pinned Backend has not delivered the new appId-based public OpenAPI. Do not use retired projectName member APIs, fabricate `members.listApp`, call uns-swe's internal `/api/v3` directly with an OpenAPI key, or infer App access by filtering workspace members in the browser.

If the requested feature depends on members who can use a particular App, state that dependency and prepare the UI/service integration boundary while the public contract is being delivered. Do not report the feature as working. See [supported capabilities](../../README.md).
