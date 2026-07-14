# QA: Beautiful Chat (OpenClaw)

Demo source: `src/app/demos/beautiful-chat/page.tsx`
Route: `/demos/beautiful-chat` · Agent: `beautiful-chat`
Runtime: `/api/copilotkit-beautiful-chat` (dedicated combined runtime)

## What it exercises

The flagship "everything" cell: one `CopilotChat` pane + an App-mode canvas,
driven by nine suggestion pills that each light up a different CopilotKit
capability. Unlike the langgraph/hermes references there is **no per-demo
backend graph** — OpenClaw is a single stateless gateway (ag-ui operator
route), so every distinctive behaviour comes from frontend-registered tools
plus the dedicated runtime's middleware. The runtime enables
`openGenerativeUI`, `a2ui` (with `injectA2UITool: false` — the frontend catalog
owns the surface), and `mcpApps` (Excalidraw) simultaneously and proxies to the
gateway via `createGatewayAgent()`.

Frontend-registered tools (forwarded to the model over AG-UI `tools`, run as
caller `clientTools` by the gateway):

- `toggleTheme` — `useFrontendTool`, flips light/dark.
- `pieChart` / `barChart` — `useComponent` (controlled generative UI).
- `scheduleTime` — `useHumanInTheLoop` (tool-based HITL, `respond()`).
- `render_a2ui` — relayed by the gateway, rendered by the frontend A2UI catalog.
- `generateSandboxedUi` — provided by the `openGenerativeUI` runtime flag.

## Known caveats (read before testing)

Some suggestion-pill prompts instruct the model to call tools that this demo
does **not** wire on OpenClaw. Test against what the demo actually backs:

- **No `query_data` tool.** The Pie Chart, Bar Chart, and Sales Dashboard pills
  tell the model to "use the `query_data` tool to fetch data first". No such
  tool is registered on the frontend and the stateless gateway has no backend
  data tool, so the model has no real dataset to fetch — it will render the
  chart / A2UI surface with model-invented sample numbers (or narrate that it
  cannot fetch). The chart/A2UI rendering itself still works; only the data is
  not real. Do not assert on specific values.
- **Task Manager (Shared State) does not populate todos via the agent.** The
  App-pane canvas reads `agent.state.todos` and can write back via
  `agent.setState`, but this demo declares no `manage_todos`
  `stateWriterTools` entry, so clicking the pill gives the model no tool to add
  todos to shared state. The To Do column will stay empty from the agent side.
  (OpenClaw _does_ support the state-writer path in general — see the
  `shared-state-read-write` cell — it is just not wired into this cell.) The
  App-pane read/write UI itself still functions on local state.
- **Excalidraw / Calculator** depend on live third-party MCP reachability
  (`mcp.excalidraw.com`) and a live LLM respectively; treat as best-effort.

## Manual steps

Run against the real backend at `http://localhost:3119/demos/beautiful-chat`.

1. Open the demo. Confirm the chat pane renders with the CopilotKit logo, the
   top-right Chat/App mode toggle, and all **nine** suggestion pills with their
   verbatim titles (Pie Chart … through Task Manager).

2. **Toggle Theme (Frontend Tools).** Click the pill. Expect the agent to call
   `toggleTheme` and the whole app to flip between light and dark (`html.dark`
   toggles). Click again — it flips back.

3. **Schedule Meeting (Human In The Loop).** Click the pill. Expect the
   `MeetingTimePicker` to mount in-transcript with slot buttons. Click a slot
   ("Tomorrow"); the picker moves to its confirmed state and the agent resumes
   with a closing confirmation.

4. **Pie Chart / Bar Chart (Controlled Generative UI).** Click each pill.
   Expect the chart to render in-transcript (donut SVG with a legend; recharts
   bar container). Per the caveat, the numbers are model-invented — assert only
   that a chart renders, not specific values.

5. **Search Flights (A2UI Fixed Schema).** Ask "Find flights from SFO to JFK for
   next Tuesday" (or click the pill). Expect flight cards to render in-transcript
   from the emitted A2UI surface, with **no** A2UI error banner ("Catalog not
   found", "Cannot create component … without a type").

6. **Sales Dashboard (A2UI Dynamic).** Click the pill. Expect an A2UI dashboard
   surface (metrics + charts) with no error banner. Data is model-invented (no
   `query_data`).

7. **Calculator App (Open Generative UI).** Click the pill. Expect a calculator
   to render inside the sandboxed iframe (`generateSandboxedUi`). Best-effort
   (live LLM).

8. **Excalidraw Diagram (MCP App).** Click the pill. Expect a sandboxed MCP-App
   iframe with the diagram. Best-effort (depends on `mcp.excalidraw.com`).

9. **Task Manager (Shared State).** Toggle to App mode; confirm the `TodoList`
   (To Do / Done columns) renders. Click the pill. Per the caveat, the agent has
   no `manage_todos` tool, so no todos are added from the agent side. Confirm the
   App-pane UI itself works: the columns render and local checkbox/edit
   interactions update the view.

## Assertion bar

- All nine pills render with verbatim titles; the page loads within ~3s.
- Toggle Theme actually flips the page theme (not just a success message).
- The HITL picker mounts and confirms on slot select.
- Pie/Bar charts and the A2UI flight/dashboard surfaces render with **no** A2UI
  render-error banner.
- No uncaught console errors; specifically no React error #31 (`{path}` leak
  from the A2UI `DynString` union) and no "Catalog not found" banner.
- Do NOT assert on chart/dashboard data values (model-invented) or on
  agent-populated todos (not wired — see caveats).

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying the `toggleTheme`
tool to the gateway operator route
(`http://127.0.0.1:8000/v1/ag-ui/operator`, Bearer gateway token,
`Accept: text/event-stream`) with a "toggle the theme" message and confirm the
SSE contains a single `TOOL_CALL_START` for `toggleTheme`, then `RUN_FINISHED`.
For the A2UI path, send the flight-search message and confirm a `render_a2ui`
tool call is relayed in the stream.
