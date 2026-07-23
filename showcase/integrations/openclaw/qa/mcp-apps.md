# QA: MCP Apps (OpenClaw)

Demo source: `src/app/demos/mcp-apps/page.tsx` (+ `chat.tsx`, `suggestions.ts`)
Route: `/demos/mcp-apps` · Agent: `mcp-apps` · Runtime: `/api/copilotkit-mcp-apps`
Run against the real backend at `http://localhost:3119/demos/mcp-apps`.

Status: **supported** via the pass-through + runtime-middleware layer (see
`PARITY_NOTES.md`). MCP Apps behaviour lives in the CopilotKit runtime, not the
gateway. Not yet individually e2e-verified — see Caveats.

## What it exercises

MCP Apps are MCP servers that expose tools with associated UI resources. The
runtime is wired with `mcpApps: { servers: [...] }` in
`api/copilotkit-mcp-apps/route.ts`, pointed at the public Excalidraw MCP app
(`https://mcp.excalidraw.com`, override via `MCP_SERVER_URL`, pinned
`serverId: "excalidraw"`). That config auto-applies the MCP Apps middleware to
the agent: when the model calls an MCP tool, the middleware fetches the
associated UI resource and emits an `activity` event, and CopilotKit's built-in
`MCPAppsActivityRenderer` (registered by `CopilotKit`, no app-side renderer)
draws the sandboxed iframe inline in the chat.

Because OpenClaw is a single stateless gateway with no per-demo backend, the MCP
tool list is resolved server-side by the runtime and the gateway relays the
model's tool calls and the resulting events — the same pass-through mechanism
that backs chat and generative UI. The page has no `data-testid` attributes and
registers no custom activity renderer.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (every demo agent name maps to the one OpenClaw endpoint).
- The Excalidraw MCP app (`https://mcp.excalidraw.com`) is reachable from the
  server, and the model behind the gateway is capable of MCP tool calls.

## Manual steps

1. Open the demo. Confirm a single centered `CopilotChat` pane renders
   (`max-w-4xl`, rounded corners, full height) and both suggestion pills show
   with verbatim titles: **"Draw a flowchart"** and **"Sketch a system
   diagram"**.
2. Send **"Hello"**. Expect a plain assistant text response — no iframe, no MCP
   activity.
3. Click **"Draw a flowchart"** (sends "Use Excalidraw to draw a simple
   flowchart with three steps."). Expect: the agent calls an Excalidraw MCP tool
   once, an inline **sandboxed iframe** renders in the transcript painting a
   flow-chart-shaped diagram (shapes connected by arrows), and a short assistant
   sentence describes what was drawn.
4. Without reloading, click **"Sketch a system diagram"**. Expect a new activity
   iframe (client → server → database) in the transcript. The first flow-chart
   iframe stays present and un-stale in the scrollback (activities persist).

## Assertion bar

- The iframe actually renders and paints a diagram (not just a "success"
  message), and it carries a `sandbox` attribute (the built-in renderer always
  sandboxes MCP UI resources).
- Exactly one MCP tool-call sequence per request (no duplicate render).
- Plain-text prompts ("Hello", "What is 2+2?") return text with no iframe.
- No console errors referencing the MCP server URL, CORS, sandbox permissions,
  or tool-schema parse failures.

## Protocol-level check (no browser)

In DevTools → Network, send a suggestion and confirm the POST to
`/api/copilotkit-mcp-apps` returns 200 and the server-side runtime resolves the
Excalidraw tool set at request time (watch server logs for the MCP Apps
middleware attaching the tools and emitting the `activity` event). The gateway
run itself relays the model's MCP tool call over AG-UI.

## Caveats

- MCP Apps rides the runtime middleware, not a ag-ui gateway capability, so
  the gateway only relays the tool call and events — it adds nothing demo
  specific here. Correct rendering depends on the runtime + the reachable
  Excalidraw MCP app.
- Not in the gateway-level verified-e2e set in `PARITY_NOTES.md`. It uses the
  same proven pass-through path as chat and generative UI but has not been
  individually e2e-checked; treat the tool-call and iframe steps as the things
  to confirm live.
- Requires network egress to `https://mcp.excalidraw.com` (or a working
  `MCP_SERVER_URL` override); with no egress the tool call fails and no iframe
  renders.
