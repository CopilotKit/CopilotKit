# @copilotkit/mcp-apps-renderer

Framework-agnostic MCP Apps host for CopilotKit: the app↔host protocol on top of
[`@modelcontextprotocol/ext-apps`](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps)
(AppBridge + PostMessage transport, sandbox proxy, per-thread request queue,
`ui/message` / `ui/open-link` / `tools/call` proxy, tool input/result forwarding,
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
