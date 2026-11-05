# Cloud Gateway enforce integration

Build the SDK, then run against a clean Backend checkout with the Cloud v2 Gateway tests:

```sh
npm run build
npm run test:gateway-enforce -- /path/to/Tier0-Backend
```

The runner prints the Backend commit, overlays `single_auth_test.go` into the real Gateway handler package without modifying that checkout, and uses `go test -p 1` with `GOMAXPROCS=2`. It requires the Backend's Go toolchain and dependencies. The fixture was validated against Backend `f931fffd291fffa31c36d2fbdf2036b69e8ef58a`.

The test runs real Gateway routing, middleware, whoami logic, and a built SDK over local HTTP. SYS and Stream RPC responses are fakes. It checks Bearer-only and X-API-Key-only ordinary requests, rejects dual credentials, checks whoami's X-API-Key/ApiKey/Bearer behavior, and makes the built SDK call whoami and Stream discovery. It does not validate a deployed service, real SYS credentials, or browser CORS.

To include a built Scaffold `getTier0AppClient` module, set `TIER0_SCAFFOLD_HELPER_ENTRY` to its absolute ESM path. The test then calls whoami and file URL through that App-key helper on the same Gateway. Use a test-only local SDK override; do not publish an unreleased dependency.
