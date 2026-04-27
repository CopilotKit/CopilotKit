---
"@copilotkit/core": patch
---

fix: forward credentials on REST transport in ProxiedCopilotRuntimeAgent

The REST transport (default `/agent/:id/connect` and `/agent/:id/run` paths)
inherited `requestInit` from `HttpAgent`, which does not include the agent's
`credentials` field. As a result, cookies were dropped on cross-origin
requests even when `credentials` was configured on the provider. Override
`requestInit` in `ProxiedCopilotRuntimeAgent` so the REST paths honor the
configured credentials, matching the single-route transport behavior.

Fixes #4198.
