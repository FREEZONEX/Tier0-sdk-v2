# Source attribution

This SDK is distributed under the MIT license in LICENSE.

The UNS lossless codec, transport safeguards and capability clients, MQTT implementation, App request identity verifier, and selected regression tests were adapted from FREEZONEX/Tier0-sdk at commit `3e43f33f4d13729e61b3d7e9bd8225a42f6843a8` (MIT). The original copyright notice is retained.

The Stream requests/messages clients, trusted App runtime and their regression/native integration fixtures were adapted from FREEZONEX/Tier0-sdk at commit `4eb0d3f3a7dbee29600ef0872cfab871e344a677` (MIT) into this standalone package. This package does not depend on the retired SDK. NATS libraries (`@nats-io/nats-core`, `@nats-io/nkeys`, `@nats-io/nuid`) retain their Apache-2.0 licenses; their dependency `tweetnacl` uses the Unlicense.

Public API contracts were obtained from FREEZONEX/Tier0-Backend at the revision pinned in `contracts/upstream.json`. The bundled App request identity contract was inherited from the same SDK revision; its upstream contract digest is preserved in the generated source. This provenance does not establish deployment or interoperability with a later gateway revision.
