# QA: Beautiful Chat (flagship combined cell) — Hermes

## Prerequisites

- Demo is deployed and accessible at `/demos/beautiful-chat` on the dashboard host
- The Hermes AG-UI adapter (`python -m agui_adapter`) is healthy on `AGENT_URL` (default `http://localhost:8000`); `OPENAI_API_KEY` is set for the adapter
- The demo is wired to `runtimeUrl="/api/copilotkit-beautiful-chat"` and `agent="beautiful-chat"` — a dedicated combined runtime (`src/app/api/copilotkit-beautiful-chat/route.ts`) that enables `openGenerativeUI`, `a2ui.injectA2UITool` (catalog `copilotkit://app-dashboard-catalog`), and `mcpApps` (Excalidraw) simultaneously and proxies to the adapter via `HttpAgent`
- 1:1 port of `integrations/langgraph-python/src/app/demos/beautiful-chat` — the `components/`, `hooks/`, `declarative-generative-ui/`, and `lib/` subtree is byte-identical (transport-agnostic v2 hooks + `@copilotkit/a2ui-renderer` catalog). Only `page.tsx` (state-writer wiring + runtime URL), the added `query_data` client handler, and the route diverge

### Hermes divergences (vs langgraph-python)

- **Shared `todos` state** — langgraph declares `todos` on its `AgentState` and mutates it via the backend `manage_todos` tool + `StateStreamingMiddleware`. Hermes has no first-class shared-state store, so the frontend DECLARES `manage_todos` → stateKey `todos` via `<CopilotKit properties={{ stateWriterTools }}>` (forwarded verbatim into `RunAgentInput.forwarded_props`); the adapter merges each call into run-scoped state and emits a `StateSnapshotEvent` the `useAgent({ agentId: "beautiful-chat" })` in `ExampleCanvas` renders. **Accepted divergence:** langgraph's `StateStreamingMiddleware` streams the `todos` array token-by-token as the tool args arrive (the App-pane TodoList grows live); the hermes adapter emits ONE snapshot after the tool call returns (snapshot-after-tool). End state is identical; only the intra-tool animation differs.
- **`search_flights` → `render_a2ui`** — langgraph's backend `search_flights` tool calls `a2ui.render(...)` and emits an `a2ui_operations` container. A generic aimock agent cannot emit an agent-side tool RESULT the middleware would detect, so the agent emits the middleware-injected `render_a2ui` directly with a flat FlightCard `Row` (identical shape to langgraph's `_build_flight_components`) into `copilotkit://app-dashboard-catalog`.
- **`query_data`** — langgraph backs this with a backend tool reading `db.csv`. Hermes registers a client-side `useFrontendTool` fake-data handler returning a deterministic sample financial dataset.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/beautiful-chat`; the page renders within 3s with the CopilotKit logo (top-left of the chat pane), the fixed top-right Chat/App mode toggle, and a centered `CopilotChat` pane
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-beautiful-chat"` and `agent="beautiful-chat"` (DevTools → Network: sending a message hits that endpoint)
- [ ] Verify all 9 suggestion pills render with verbatim titles: "Pie Chart (Controlled Generative UI)", "Bar Chart (Controlled Generative UI)", "Schedule Meeting (Human In The Loop)", "Search Flights (A2UI Fixed Schema)", "Sales Dashboard (A2UI Dynamic)", "Excalidraw Diagram (MCP App)", "Calculator App (Open Generative UI)", "Toggle Theme (Frontend Tools)", "Task Manager (Shared State)"

### 2. Feature-Specific Checks

#### Toggle Theme (Frontend Tools — `toggleTheme` via `useFrontendTool`)

- [ ] Click "Toggle Theme (Frontend Tools)"; within 30s verify `document.documentElement`'s class flips between `light` and `dark` (proves the agent responded AND the frontend tool fired). Repeat: each click flips it back.

#### Pie Chart / Bar Chart (Controlled Generative UI — `useComponent`)

- [ ] Click "Pie Chart (Controlled Generative UI)"; within 45s verify a donut `<svg>` renders with at least 3 `<circle>`s (1 background + one per slice; fixture ships 4 slices) and a legend row with a `%` value
- [ ] Click "Bar Chart (Controlled Generative UI)"; within 45s verify a `.recharts-responsive-container` mounts with at least 2 `.recharts-bar-rectangle` bars
- [ ] (Live/direct-LLM) verify the model calls `query_data` first, then renders the chart with the returned rows

#### Schedule Meeting (Human In The Loop — `scheduleTime` via `useHumanInTheLoop`)

- [ ] Click "Schedule Meeting (Human In The Loop)"; within 60s verify the `MeetingTimePicker` mounts showing "Pick a time that works for you" with slot buttons ("Tomorrow", "Friday", "Next Monday")
- [ ] Click the "Tomorrow" slot; verify the picker transitions to its confirmed state ("Meeting Scheduled") and the agent resumes with a closing confirmation

#### Search Flights (A2UI Fixed Schema — middleware-injected `render_a2ui`)

- [ ] Click "Search Flights (A2UI Fixed Schema)"; within 60s verify two `FlightCard`s render in-transcript from the emitted A2UI surface, with visible literals "United" / "$349" and "Delta" / "$289" (SFO → JFK)
- [ ] Verify no A2UI render-error banners appear (no "Catalog not found", no "Cannot create component ... without a type")

#### Sales Dashboard (A2UI Dynamic — `render_a2ui`)

- [ ] (Live/direct-LLM) Click "Sales Dashboard (A2UI Dynamic)"; verify a dashboard surface renders with Metric labels (e.g. "Total Revenue"), a PieChart, and a BarChart, and no "Catalog not found" banner. **Excluded from the deterministic aimock D5/e2e suite** — aimock's non-progressive arg streaming differs from a live LLM in a way the A2UI binder is sensitive to for `Row`-bound recharts children (see `harness/src/probes/scripts/_beautiful-chat-shared.ts`).

#### Excalidraw Diagram (MCP App — `mcpApps` / Excalidraw server)

- [ ] (Live) Click "Excalidraw Diagram (MCP App)"; verify a sandboxed iframe MCP App renders the diagram. **Excluded from the scheduled D5 probe** — depends on `mcp.excalidraw.com` reachability (third-party uptime). The same MCP Apps activity-render path is covered deterministically by the `mcp-apps` cell.

#### Calculator App (Open Generative UI — `generateSandboxedUi`)

- [ ] (Live) Click "Calculator App (Open Generative UI)"; verify a calculator renders inside the sandboxed iframe. **Excluded from the D5 probe** — cross-frame Playwright assertions are fragile; `generateSandboxedUi` is covered deterministically by the `open-gen-ui` cell.

#### Task Manager (Shared State — `manage_todos` state-writer + App pane)

- [ ] Toggle to "App" mode (or send a Task Manager prompt that enables app mode); the App pane shows the `TodoList` (To Do / Done columns)
- [ ] Click "Task Manager (Shared State)"; verify three todos about learning CopilotKit appear in the To Do column (from the emitted `StateSnapshotEvent`). **Snapshot-after-tool divergence:** todos appear atomically after the `manage_todos` call rather than growing per-token (see divergence note above). **Excluded from the scheduled D5 probe** for the same aimock state-propagation reason as Sales Dashboard.
- [ ] Verify the UI can write back: toggle a todo's checkbox / edit a title and confirm the App-pane state updates via `agent.setState`

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] DevTools → Console: walk through all flows above; verify no uncaught errors and specifically no React error #31 (`{path}` leak from the A2UI `DynString` union) and no A2UI "Catalog not found" banner

## Expected Results

- Chat loads within 3s; all 9 pills render with verbatim titles
- Toggle Theme flips `html.dark` within 30s; Pie/Bar charts render within 45s; the HITL picker mounts within 60s and confirms on slot select; the FlightCard surface renders (United $349 / Delta $289) within 60s
- No A2UI render-error banners, no `{path}` leak, no uncaught console errors
- The four pills excluded from the deterministic aimock D5/e2e suite (Sales Dashboard, Excalidraw, Calculator, Task Manager) work against a live LLM / live MCP server per the notes above; their sub-mechanisms are each covered deterministically by a dedicated hermes cell (`declarative-gen-ui`, `mcp-apps`, `open-gen-ui`, `shared-state-read-write` / `gen-ui-agent`)

```

```
