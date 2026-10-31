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
| `@copilotkit/mcp-apps-renderer/activity` | `MCPAppsActivityType`, `MCPAppsActivityContentSchema`, `ɵrunMcpFollowUp` | ESM + CJS. Re-exports `@copilotkit/shared`; bridge-free, so it does **not** pull the ext-apps bundle.            |

The root is ESM-only on purpose: `@modelcontextprotocol/ext-apps` ships ESM only,
so a CommonJS root would emit a `require()` of an ES module and fail with
`ERR_REQUIRE_ESM`. Consume `bindMcpApp` via a dynamic `import()` (which resolves
ESM from any module system).

The bridge-free part of the `/activity` surface (the activity type, the content
schema, and the follow-up runner) is authored in `@copilotkit/shared` and
re-exported here. `@copilotkit/react-core`, `@copilotkit/vue`, and
`@copilotkit/angular` register the built-in MCP Apps activity from
`@copilotkit/shared` directly, and declare this package as an **optional peer
dependency** — so an app that never renders an MCP App does not install it.

## Installing

If you render MCP Apps, install the renderer alongside your frontend package:

```bash
npm install @copilotkit/mcp-apps-renderer
```

If it is missing, the adapter reports the package name in the setup error when
the first MCP App renders; apps without MCP Apps never load it. One build-time
exception: webpack older than 5.90.2 resolves that lazy `import()` eagerly
(5.90.2 is the first release that treats an `import()` inside `try/catch` as
optional), so bundling an adapter with an older webpack requires this package to
be installed even for apps that never render an MCP App.

## Script-tag / UMD usage

This package also ships a UMD build of the `/activity` entry:
`dist/activity.umd.js`, which defines the global
`CopilotKitMcpAppsRendererActivity`. The surface lives in `@copilotkit/shared`,
so load its global (`CopilotKitShared`) first:

```html
<!-- ...React, Zod, @copilotkit/shared, @copilotkit/core, etc. first... -->
<script src="https://unpkg.com/@copilotkit/shared/dist/index.umd.js"></script>
<script src="https://unpkg.com/@copilotkit/mcp-apps-renderer/dist/activity.umd.js"></script>
```

`@copilotkit/react-core`'s UMD build no longer references this global: it
registers the MCP Apps activity from its `CopilotKitShared` global instead, so
you only need `activity.umd.js` if you register the activity yourself.

Only the bridge-free surface has a UMD build; the ext-apps bridge itself
(`bindMcpApp`) is loaded lazily via `import()` and is not part of the UMD graph,
so it only loads when an MCP App is actually rendered.
