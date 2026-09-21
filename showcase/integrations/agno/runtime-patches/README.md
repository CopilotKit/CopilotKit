# MCP proxy isolation for Agno Showcase

Runtime 1.68.2 sends iframe MCP resource reads through the conversation runner.
A resource read can claim a thread while a user message starts, rejecting that
message with `Thread already running` and an empty successful SSE response.

The image build adds a validated proxy branch to the installed runtime's two
SSE run modules. Requests without the reserved proxy marker keep the original
runner path unchanged. The proxy executes existing middleware on its request
clone, without conversation persistence or runner ownership. It retains the
configured MCP server, authentication, method validation and resource transport.
Malformed proxy requests and agents without an MCP configuration are rejected.

`apply.cjs` checks the exact package version and input/output hashes before
writing. It fails on version drift, changed module bytes, or a partial patch.
No dependencies, lockfiles, package versions or licenses change. The original
MIT-licensed package and its license remain in the image. Source-map comments
identify the original `src/v2/runtime/handlers/sse/run.ts` boundary; inserted
logic is maintained here as readable CommonJS shared by both module formats.

This is scoped to the Agno image. It does not publish or upgrade the runtime.
Remove it when Agno adopts a runtime with independently verified MCP proxy
isolation, then rerun the original diagram, 15-occurrence repeat and shared
headless preservation checks. Track removal with the S19 repair PR; do not
silently refresh hashes for a new runtime release.
