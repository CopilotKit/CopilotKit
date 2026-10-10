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

## Display modes

`bindMcpApp` negotiates `ui/request-display-mode` for every frontend:

- The host renders `inline` and `fullscreen` (`HOST_SUPPORTED_DISPLAY_MODES`);
  `pip` is never granted. A request for an unavailable mode leaves the mode
  untouched and answers with the mode still applied.
- A mode the app did not list in `appCapabilities.availableDisplayModes` at
  `ui/initialize` is refused the same way. `options.hostContext.availableDisplayModes`
  narrows what the host offers (`inline` always stays).
- `hostContext` carries `displayMode` and `availableDisplayModes` from
  construction on, so the `ui/initialize` response already advertises them.
  Every change, widget-initiated or host-initiated, goes through the same path
  and reaches the widget as `ui/notifications/host-context-changed`;
  `fullscreen` also advertises its `containerDimensions`.
- The adapter renders the mode: `hooks.onDisplayModeChange(mode)` tells it what
  was granted, `session.setDisplayMode("inline")` is the host-initiated exit
  (close button, Escape) and `session.getDisplayMode()` reads the current mode.
  `setDisplayMode` is bound by the same offer: a mode the host does not render
  is ignored, so the widget is never told about one.

The bridge-free `/activity` entry ships the pieces the adapters need to render
the surface without the bridge: `ɵshowDialogForMode(dialog, mode)` opens the
widget's native `<dialog>` in normal flow for `inline` and in the browser top
layer (`showModal()`) for `fullscreen`, so it fills the viewport whatever
containing block an ancestor establishes, without ever reparenting the iframe;
`ɵlockBodyScroll()` is the page-wide, ref-counted scroll lock behind a
fullscreen widget.

Escape exits fullscreen through the dialog's `cancel` event, which the browser
only fires while focus is on the host side: a key pressed inside the sandboxed
widget never leaves its iframe. The adapters therefore land focus on the exit
button when fullscreen opens; once the user has clicked into the widget, the
button (or the widget's own `requestDisplayMode("inline")`) is the way out.

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
