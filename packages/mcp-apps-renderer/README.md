# @copilotkit/mcp-apps-renderer

Framework-agnostic MCP Apps host for CopilotKit: the app↔host protocol on top of
[`@modelcontextprotocol/ext-apps`](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps)
(AppBridge + PostMessage transport, sandbox proxy, per-thread request queue,
`ui/message` / `ui/open-link` / `tools/call` proxy, tool input/result forwarding,
`ui/update-model-context`,
`ui/request-display-mode`). The React / Vue / Angular renderers consume it as thin
adapters: they create the sandbox iframe and wire reactive state, while all
protocol logic lives in `bindMcpApp`.

## Entry points

| Import                                   | Contents                                                                 | Bundle                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `@copilotkit/mcp-apps-renderer`          | `bindMcpApp` + the full session API                                      | **ESM only** — it wraps the ESM-only ext-apps bridge, and is meant to be loaded lazily via a dynamic `import()`. |
| `@copilotkit/mcp-apps-renderer/activity` | `MCPAppsActivityType`, `MCPAppsActivityContentSchema`, `ɵrunMcpFollowUp` | ESM + CJS. Bridge-free: importing it to register the activity does **not** pull the ext-apps bundle.             |

The root is ESM-only on purpose: `@modelcontextprotocol/ext-apps` ships ESM only,
so a CommonJS root would emit a `require()` of an ES module and fail with
`ERR_REQUIRE_ESM`. Consume `bindMcpApp` via a dynamic `import()` (which resolves
ESM from any module system), and import the bridge-free `/activity` surface for
synchronous activity registration.

## Model context (`ui/update-model-context`)

A widget can report its state (a selection, the filters it shows, a cart) so the
model sees it on the next turns of the conversation, without adding a chat
message and without starting a run:

```ts
await app.updateModelContext({
  content: [{ type: "text", text: "The user is looking at the Lyon station." }],
  structuredContent: { stationId: "lyon", filter: "available" },
});
```

- **Storage.** `bindMcpApp` stores the snapshot in the host passed as `host`
  when it can (`upsertContext` + `removeContext`, which `CopilotKitCore`
  provides), and only then announces
  `hostCapabilities.updateModelContext: { text: {}, structuredContent: {} }`.
  A host without that storage announces nothing and answers the request with
  "method not found", never with a fake acknowledgement.
- **Replacement.** One entry per widget instance: each update replaces the
  previous one, and two widgets keep separate entries. An update with no
  content (absent or `[]`) and no `structuredContent` clears the widget's
  entry; `structuredContent: {}` is a valid, empty state.
- **Contents.** Text blocks (in order) and `structuredContent` go into one
  deterministic JSON value. Image, audio and resource blocks are refused with
  a JSON-RPC error. A snapshot above `MCP_APPS_MODEL_CONTEXT_MAX_LENGTH`
  characters (32 KiB) is refused too; a refused update leaves the previous
  snapshot in place.
- **Scope.** The entry is scoped to the agent and the conversation the widget
  was opened in, under a key the host builds (agent, thread, activity message,
  resource). An iframe still mounted after the shared agent moved to another
  thread is refused rather than writing into the new conversation. Runs,
  reconnections and suggestion requests only receive the entries of the
  thread they serve.
- **Lifetime.** The snapshot lives in the core, in memory, not in the DOM:
  unmounting the widget keeps it, so a `ui/message` follow-up that waited in
  the queue still sees it. Deleting the conversation through the thread store
  removes it. A page reload does not restore it, and an update received during
  a run applies to the following runs only.
- **Trust.** The content comes from third-party UI. Its description names the
  widget and states that the value is data it reported, not instructions. The
  built-in agent places application context in its system prompt, so keep
  that in mind when you decide which MCP servers to trust; agents other than
  the built-in one receive it in `RunAgentInput.context` and must read it
  there to use it.

## Script-tag / UMD usage

This package also ships a UMD build of the bridge-free `/activity` entry:
`dist/activity.umd.js`, which defines the global
`CopilotKitMcpAppsRendererActivity`.

`@copilotkit/react-core`'s UMD build references that global (it externalizes
`@copilotkit/mcp-apps-renderer/activity` to register the built-in MCP Apps
activity). **Script-tag consumers of react-core's UMD must therefore load
`activity.umd.js` before `@copilotkit/react-core`'s UMD bundle**, alongside the
other UMD globals it depends on (React, `CopilotKitCore`,
`CopilotKitA2UIRenderer`, …):

```html
<!-- ...React, @copilotkit/core, @copilotkit/a2ui-renderer, etc. first... -->
<script src="https://unpkg.com/@copilotkit/mcp-apps-renderer/dist/activity.umd.js"></script>
<script src="https://unpkg.com/@copilotkit/react-core/dist/index.umd.js"></script>
```

Only the bridge-free `/activity` surface has a UMD build; the ext-apps bridge
itself (`bindMcpApp`) is loaded lazily via `import()` and is not part of the UMD
graph, so it only loads when an MCP App is actually rendered.
