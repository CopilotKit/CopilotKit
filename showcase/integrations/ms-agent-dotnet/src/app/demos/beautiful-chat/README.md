# Beautiful Chat demo (MS Agent Framework, .NET)

Flagship showcase cell that simultaneously exercises:

- **A2UI** — both fixed-schema (`search_flights`) and dynamic-schema
  (`generate_a2ui`) component rendering, via the dashboard catalog under
  `declarative-generative-ui/`.
- **Open Generative UI** — `openGenerativeUI: true` on the runtime, so the
  model can sandbox-render arbitrary React UIs on demand.
- **MCP Apps** — an HTTP MCP server (default `https://mcp.excalidraw.com`)
  wired in via `mcpApps.servers`.

## Architecture

- Frontend: verbatim port of the LangGraph reference at
  `showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/`.
- Runtime: `/api/copilotkit-beautiful-chat` — combines OGUI + A2UI + MCP
  flags on a single runtime, scoped to this cell only so other demos keep
  their per-cell feature boundaries.
- Agent: `agent/BeautifulChatAgent.cs` — ChatClientAgent with `query_data`,
  `get_todos`, `manage_todos`, `get_weather`, `search_flights`,
  `generate_a2ui`. Mounted at `/beautiful-chat` in `Program.cs`.

## Suggestion pills

The chat UI surfaces nine suggestions spanning:

- Pie/bar charts via Controlled Generative UI (`useComponent`)
- Meeting scheduling via Human In The Loop
- Flight cards via A2UI fixed schema
- Sales dashboard via A2UI dynamic generation
- Excalidraw diagram via the MCP server
- Calculator UI via Open Generative UI
- Theme toggle via a frontend tool
- Task Manager backed by shared state (todos)

## Data

Sample financial data is embedded in `BeautifulChatAgent.cs` (the
`_sampleFinancialData` static initializer) so no CSV shipping is required.
The LangGraph reference reads it from `beautiful_chat_data/db.csv`; the .NET
port flattens that inline for a self-contained binary.
