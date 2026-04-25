# QA: Beautiful Chat — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `OPENAI_API_KEY` set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/beautiful-chat`
- [ ] Verify the polished two-column layout renders with the chat column
      and a toggle between "Chat" and "App" modes
- [ ] Verify suggestion pills render in the chat

### 2. Controlled Generative UI (Charts)

- [ ] Click "Pie Chart (Controlled Generative UI)"
- [ ] Verify the agent calls `query_data` then renders a pie chart inline
- [ ] Click "Bar Chart" and verify a bar chart renders

### 3. A2UI

- [ ] Click "Search Flights (A2UI Fixed Schema)"
- [ ] Verify 2 flight cards render inline via the fixed flight catalog
- [ ] Click "Sales Dashboard (A2UI Dynamic)"
- [ ] Verify a dashboard with metrics + charts renders

### 4. Open Generative UI

- [ ] Click "Calculator App (Open Generative UI)"
- [ ] Verify a sandboxed calculator iframe mounts

### 5. Shared State (Todos)

- [ ] Click "Task Manager (Shared State)"
- [ ] Verify the layout flips to "App" mode and todos appear in the
      right-hand canvas
- [ ] Toggle a todo's checkbox; verify the UI updates locally
- [ ] Edit a todo title/description; verify it persists

### 6. Frontend Tools

- [ ] Click "Toggle Theme (Frontend Tools)"
- [ ] Verify the dark/light theme flips via the `toggleTheme` tool

### 7. HITL

- [ ] Click "Schedule Meeting (Human In The Loop)"
- [ ] Verify a time picker modal opens in chat

## Known Limitations vs. langgraph-python port

- **MCP Apps (Excalidraw)**: not wired on the PydanticAI backend; the
  "Excalidraw Diagram" suggestion pill is intentionally omitted here.
  Tracked in PARITY_NOTES.md.
- **Per-token state streaming**: langgraph-python uses
  `StateStreamingMiddleware` to stream per-token todo deltas. PydanticAI's
  `agent.to_ag_ui()` emits a single `STATE_SNAPSHOT` on `manage_todos`
  completion instead. Functionally equivalent — the todo list still
  appears — but does not animate character-by-character.

## Expected Results

- Fixed-schema flight cards, dynamic-schema dashboards, sandboxed iframes,
  the HITL time picker, and the shared todos canvas all render in a
  single combined cell powered by the `beautiful_chat` PydanticAI agent.
