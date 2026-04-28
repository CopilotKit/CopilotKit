# Beautiful Chat (MS Agent Framework)

Flagship MS Agent Framework showcase that combines A2UI (fixed + dynamic),
Open Generative UI, MCP Apps, shared state (todos), and HITL in a single
polished sales-dashboard demo.

## Architecture

- **Frontend** (`src/app/demos/beautiful-chat/`):
  - `page.tsx` wires `<CopilotKit>` with the demonstration A2UI catalog and
    enables `openGenerativeUI`.
  - `components/example-layout` swaps between a chat view and an app view
    via frontend tools (`enableAppMode` / `enableChatMode`).
  - `components/example-canvas` renders the shared-state todos kanban.
  - `hooks/use-generative-ui-examples` registers controlled generative UI
    (`pieChart`, `barChart`), HITL (`scheduleTime` via `MeetingTimePicker`),
    frontend tools (`toggleTheme`), and default tool rendering (`ToolReasoning`).
  - `hooks/use-example-suggestions` wires the suggestion pills.
  - `declarative-generative-ui/renderers.tsx` assembles the A2UI component
    catalog used for dynamic dashboards and fixed flight cards.
- **Runtime** (`src/app/api/copilotkit-beautiful-chat/route.ts`):
  Dedicated route enabling `openGenerativeUI: true`,
  `a2ui.injectA2UITool: false`, and `mcpApps` pointed at Excalidraw by
  default. Proxies to the Python agent server at `/beautiful-chat`.
- **Agent** (`src/agents/beautiful_chat.py`):
  `AgentFrameworkAgent` backed by `OpenAIChatClient` with the tool surface
  for the demo: `manage_todos`, `query_data` (served from
  `beautiful_chat_data/db.csv`), `search_flights` (fixed-schema A2UI),
  and `generate_a2ui` (dynamic A2UI via a secondary LLM call).
- **Mounting**: see `src/agent_server.py` -- the beautiful-chat agent is
  mounted on `/beautiful-chat` before the catch-all `/` endpoint.

## Data

Sales CSV + flight A2UI schema ship under
`src/agents/beautiful_chat_data/`. The agent reads the CSV at module load
time to avoid per-request file I/O.

## Notes on framework parity

The canonical reference is LangGraph + Python (see
`showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/`).
The MS Agent Framework port preserves the frontend tree verbatim and
reimplements the tool surface on `agent_framework.Agent` with the shared
Python tool helpers in `showcase/shared/python/tools/`.
