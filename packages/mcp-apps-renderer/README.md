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

## Display modes

`bindMcpApp` negotiates `ui/request-display-mode` for every frontend:

- The host renders `inline` and `fullscreen` (`HOST_SUPPORTED_DISPLAY_MODES`),
  and `McpAppsDisplayMode` carries only those two; `pip` exists in the spec but
  is never granted. A request for an unavailable mode leaves the mode untouched
  and answers with the mode still applied.
- A mode the app did not list in `appCapabilities.availableDisplayModes` at
  `ui/initialize` is refused the same way. `options.hostContext.availableDisplayModes`
  narrows what the host offers (`inline` always stays); React exposes it as
  `<CopilotKit mcpApps>`, Vue as `<CopilotKitProvider :mcp-apps>`, Angular as
  `provideMCPApps()`.
- `fullscreen` is only granted on a user action in the widget itself.
  Transient activation (`navigator.userActivation.isActive`) belongs to the
  whole page, so a key press in the chat composer would count as much as a
  click in the widget. The gate (`fullscreen-gate.ts`) therefore also requires
  that the widget's iframe holds the focus and that no `pointerdown` or
  `keydown` reached the host page in the last 5 seconds (the activation
  window of Chromium and Firefox): events inside the iframe never reach the
  host document, so a recent host-side gesture means the activation may come
  from the host. Where the activation API is missing, the focus and
  host-gesture checks still apply.
- After the host took a widget out of fullscreen (close button, Escape), every
  widget on the page is refused until the activation has been observed
  inactive, then granted again on a fresh gesture: activation outlives the
  closing gesture for a duration the browser chooses, and the modal dialog
  makes the rest of the page inert. Without the activation API the block
  stays for the rest of the page's life.
- `hostContext` carries `displayMode` and `availableDisplayModes` from
  construction on, so the `ui/initialize` response already advertises them.
  Every change, widget-initiated or host-initiated, goes through the same path
  and reaches the widget as `ui/notifications/host-context-changed`, always
  with `containerDimensions`: the viewport for `fullscreen`, and for `inline`
  the width of the nearest laid-out ancestor of the dialog, and only a width,
  since the inline container grows with the widget's content. The app SDK
  merges notifications into its cached context and the protocol cannot unset
  a field, so leaving fullscreen advertises the inline surface rather than
  dropping the fullscreen one.
- The adapter renders the mode: `hooks.onDisplayModeChange(mode)` tells it what
  was granted, `session.setDisplayMode("inline")` is the host-initiated exit
  (close button, Escape) and `session.getDisplayMode()` reads the current mode.
  `setDisplayMode` is bound by the same offer: a mode the host does not render
  is ignored, so the widget is never told about one.

The bridge-free `/activity` entry ships the pieces the adapters need to render
the surface without the bridge: `ɵshowDialogForMode(dialog, mode)` opens the
widget's native `<dialog>` in the browser top layer (`showModal()`) for
`fullscreen`, so it fills the viewport whatever containing block an ancestor
establishes, and leaves it closed for `inline`, where the adapters render the
closed dialog in normal flow (`display: block`), without ever reparenting the
iframe. `ɵdialogRoleForMode(mode)` gives the role to render: inline the widget
is chat content and is exposed as a group, fullscreen keeps the modal dialog's
semantics. `ɵlockBodyScroll()` is the page-wide, ref-counted scroll lock
behind a fullscreen widget. The surface carries an accessible name in both
modes ("Interactive MCP application", with a fullscreen variant).

Opening a dialog, even with `show()`, runs the browser's dialog focusing steps,
which move the focus into it. The inline dialog is never opened, so a widget
arriving while the user types never takes the focus from the composer (no blur
either); only `fullscreen` takes it, and the adapters then land it on the exit
button. Escape exits fullscreen through the dialog's `cancel`
event, which the browser only fires while focus is on the host side: a key
pressed inside the sandboxed widget never leaves its iframe. Once the user has
clicked into the widget, the button (or the widget's own
`requestDisplayMode("inline")`) is the way out.

A size the widget reports while fullscreen describes the fullscreen layout: the
adapters keep only sizes reported inline, so leaving fullscreen restores the
inline height. While fullscreen, `ɵwatchViewportResize` re-advertises the
viewport only when it actually changed, at most once per animation frame.

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

- **Opt-in.** Off by default: the frontend enables it with
  `options.modelContext: true` (`mcpApps.modelContext` in React and Vue,
  `provideMCPApps({ modelContext: true })` in Angular). With it, the widget of
  any MCP server the agent uses can write into what the model reads, the
  built-in agent's system prompt included, without the user seeing it.
- **Storage.** With the opt-in, `bindMcpApp` stores the snapshot in the host
  passed as `host` when it can (`upsertContext` + `removeContext`, which
  `CopilotKitCore` provides), and only then announces
  `hostCapabilities.updateModelContext: { text: {}, structuredContent: {} }`.
  Without the opt-in or that storage, it announces nothing and answers the
  request with "method not found", never with a fake acknowledgement.
- **Replacement.** One entry per widget resource in a conversation: each
  update replaces the previous one, two different widgets keep separate
  entries, and two instances of the same widget share one. The number of
  entries is bounded by the number of distinct widgets, not by how often they
  are opened. An update with no
  content (absent or `[]`) and no `structuredContent` clears the widget's
  entry; `structuredContent: {}` is a valid, empty state.
- **Contents.** Text blocks (in order) and `structuredContent` go into one
  deterministic JSON value. Image, audio and resource blocks are refused with
  a JSON-RPC error. A snapshot whose serialized JSON is longer than
  `MCP_APPS_MODEL_CONTEXT_MAX_LENGTH` (32,768 characters, measured on the
  string's length, not its byte size) is refused too; a refused update leaves
  the previous snapshot in place.
- **Scope.** The entry is scoped to the agent and the conversation the widget
  was opened in, under a key the host builds (agent, thread, server,
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
