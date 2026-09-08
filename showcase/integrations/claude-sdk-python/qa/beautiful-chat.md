# QA: Beautiful Chat — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/beautiful-chat` on the dashboard host
- Agent backend is healthy: `GET /api/health` returns `{"status":"ok","integration":"claude-sdk-python"}`, and `GET /api/copilotkit` reports `agent_status: "reachable"` (it polls `${AGENT_URL}/health` on the FastAPI backend)
- `ANTHROPIC_API_KEY` is set on the deployment; `ANTHROPIC_MODEL` defaults to `claude-opus-4-8`; `AGENT_URL` (default `http://localhost:8000`) points at the FastAPI server exposing `POST /beautiful-chat` (`src/agent_server.py`)
- Note: the demo source contains no `data-testid` attributes. Checks below rely on verbatim visible text and DOM structure.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/beautiful-chat`; verify the page renders within 3s with the "CopilotKit" wordmark plus the logo mark (`img[alt="CopilotKit"]`, src `/copilotkit-logo-mark.svg`) top-left of the chat pane
- [ ] Verify the `Chat` / `App` mode pill is fixed top-right, `Chat` active (highlighted) by default, and the right-side canvas region is collapsed (width 0)
- [ ] Verify the `CopilotChat` input is rendered with no disclaimer text below it, and that attachments are enabled
- [ ] Verify all 9 suggestion pills are visible with verbatim titles (`showcase.json` is `"default"`, so no pill carries a highlight class):
  - "Pie Chart (Controlled Generative UI)"
  - "Bar Chart (Controlled Generative UI)"
  - "Schedule Meeting (Human In The Loop)"
  - "Search Flights (A2UI Fixed Schema)"
  - "Sales Dashboard (A2UI Dynamic)"
  - "Excalidraw Diagram (MCP App)"
  - "Calculator App (Open Generative UI)"
  - "Toggle Theme (Frontend Tools)"
  - "Task Manager (Shared State)"
- [ ] Send "Hello" and verify an assistant text response appears within 10s
- [ ] DevTools → Network: verify the send POSTs to `/api/copilotkit-beautiful-chat` (the dedicated runtime, not the shared `/api/copilotkit`)

### 2. Feature-Specific Checks

#### Mode Toggle (frontend tools `enableAppMode` / `enableChatMode`)

- [ ] Click `App`; verify the canvas expands to ~2/3 width showing the TodoList empty state: pencil emoji, heading "No todos yet", subtext "Create your first task to get started", enabled "Add a task" button
- [ ] Click `Chat`; verify the canvas collapses back to width 0

#### Shared State — Task Manager (agent tools `manage_todos`, `get_todos`)

- [ ] Click the "Task Manager (Shared State)" pill; verify the mode auto-switches to App (the system prompt in `src/agents/agent.py` routes todos through `enableAppMode` first) and within 15s the "To Do" column renders exactly 3 todo cards (each with emoji, title, description)
- [ ] Verify the "Done" column is empty (shows "No completed todos yet")
- [ ] Click a todo's checkbox; verify the card moves from "To Do" to "Done"

#### Controlled Generative UI — Pie Chart (agent tool `query_data` + frontend component `pieChart`)

- [ ] Click "Pie Chart (Controlled Generative UI)"; within 15s verify a pie-chart card renders in-transcript with a non-empty `CardTitle` and `CardDescription`
- [ ] Verify the donut SVG renders at least 2 `<circle>` slice elements inside the card
- [ ] Verify the legend renders one row per slice: colored dot, label, comma-formatted value, and a percentage ending in "%"; percentages sum to 100%

#### Controlled Generative UI — Bar Chart (agent tool `query_data` + frontend component `barChart`)

- [ ] Click "Bar Chart (Controlled Generative UI)"; within 15s verify a bar-chart card renders with `CardTitle`, `CardDescription`, and a bar-chart icon in the header
- [ ] Verify the recharts `ResponsiveContainer` (height 280px) renders at least 2 bar rectangles with X-axis labels matching the `label` field values; bars animate in via the `barSlideIn` keyframe on first render

#### Human-in-the-Loop — Schedule Meeting (frontend tool `scheduleTime`)

- [ ] Click "Schedule Meeting (Human In The Loop)"; within 15s verify a MeetingTimePicker card renders with a clock icon, a heading (agent-supplied `reasonForScheduling` or default "Schedule a Meeting"), 3 time-slot buttons each with date + time + a "30 min" duration badge, and a "None of these work" ghost button
- [ ] Click a time slot; verify the card switches to the confirmed state with heading "Meeting Scheduled", the chosen date/time, and a green check icon
- [ ] Re-trigger, click "None of these work"; verify the card shows heading "No Time Selected" and subtext "Looking for a better time that works for you"

#### A2UI Fixed Schema — Search Flights (agent tool `search_flights`)

- [ ] Click "Search Flights (A2UI Fixed Schema)"; within 20s verify exactly 2 flight cards render in-transcript, each with airline name, airline logo image, flight number, origin/destination, date, departure/arrival times, duration, a colored status dot, a status label (e.g. "On Time"), and a price
- [ ] Note: the beautiful-chat runtime sets `injectA2UITool: false` with `defaultCatalogId: "copilotkit://app-dashboard-catalog"` — the same id the `demonstrationCatalog` registers, so cards must resolve against the local catalog rather than an injected tool

#### A2UI Dynamic — Sales Dashboard (agent tool `generate_a2ui`)

- [ ] Click "Sales Dashboard (A2UI Dynamic)"; within 30s verify a dynamic dashboard surface renders containing total-revenue metric, new-customers metric, conversion-rate metric, a pie chart (revenue by category), and a bar chart (monthly sales)

#### MCP App — Excalidraw Diagram

- [ ] Click "Excalidraw Diagram (MCP App)"; within 30s verify an Excalidraw embed renders a diagram with a router, 2 switches, and 4 computers (no console errors referencing `MCP_SERVER_URL`, default `https://mcp.excalidraw.com`, pinned `serverId: "excalidraw"`)

#### Open Generative UI — Calculator App (`generateSandboxedUi`)

- [ ] Click "Calculator App (Open Generative UI)"; within 30s verify a sandboxed calculator UI renders with digit/operator buttons plus labeled metric shortcut buttons
- [ ] Click a metric shortcut button; verify its value is inserted into the calculator display

#### Frontend Tool — Toggle Theme (`toggleTheme`)

- [ ] Click "Toggle Theme (Frontend Tools)"; verify the `html` element's `class` attribute flips between containing `dark` and containing `light` (the `ThemeProvider` removes both classes then adds the active one)

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Send a ~500-character message; verify it wraps in-transcript without horizontal scroll or layout break
- [ ] With the FastAPI backend stopped, send a message; verify the UI surfaces a visible error path rather than hanging silently, and DevTools → Console shows no uncaught errors during any flow above

## Expected Results

- Chat loads within 3 seconds; plain-text response within 10 seconds
- Controlled charts (pie/bar) render within 15 seconds of prompt; A2UI surfaces within 20–30 seconds
- No UI layout breaks, no flash of unstyled content, no uncaught console errors
- All 5 agent tools reachable via `BEAUTIFUL_CHAT_TOOLS` in `src/agents/agent.py` (`query_data`, `search_flights`, `generate_a2ui`, `manage_todos`, `get_todos`) are exercised by at least one check above
