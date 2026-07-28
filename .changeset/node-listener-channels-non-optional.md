---
"@copilotkit/runtime": patch
---

Fix the managed-Channel lifecycle contract on the long-running endpoint wrappers.

`createCopilotNodeListener` now mirrors `createCopilotRuntimeHandler`'s branded
overload: a runtime constructed with at least one declared Channel yields a
listener whose `.channels` is non-optional, so the documented
`listener.channels.ready()` call type-checks without a `!` or `?.`. Opting out
via `activateChannels: false`, and every runtime without declared Channels, keeps
the optional shape. `NodeCopilotListener` and the new
`NodeCopilotListenerWithChannels` are exported from `@copilotkit/runtime/v2/node`.

Also corrects TSDoc on the node, express, and hono wrappers that still claimed
Channel activation happens "at creation time" and labelled `ready()` as optional.
Activation has been lazy — triggered by the first `channels.ready()` — since the
Fetch handler was made serverless-safe; on a long-running host that call is
required, not optional.
