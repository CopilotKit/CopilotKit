# MCP Apps — Langroid

Renders MCP UI resources inline in the chat as sandboxed iframes. The CopilotKit runtime wires the MCP Apps middleware via `mcpApps: { servers: [...] }`; when the agent calls an MCP tool, the middleware fetches the resource and emits an activity event that the built-in `MCPAppsActivityRenderer` renders.

## Topology

- **Page** — `src/app/demos/mcp-apps/page.tsx`. Plain `<CopilotChat />` plus pre-seeded suggestion pills. No `useRenderActivityMessage` — the activity renderer is auto-registered.
- **Runtime route** — `src/app/api/copilotkit-mcp-apps/route.ts`. Configures `mcpApps.servers` pointing at `https://mcp.excalidraw.com`. Pins a stable `serverId: "excalidraw"` so persisted threads survive URL changes.
- **Agent** — `src/agents/mcp_apps_agent.py`, mounted by `agent_server.py` at `POST /mcp-apps`. Declares **no** local langroid tools — the runtime middleware injects the MCP tool catalog into `RunAgentInput.tools` per request, and the agent forwards it straight to OpenAI's chat completions API. Any `tool_call` the model emits is surfaced as AG-UI `TOOL_CALL_*` events; the runtime middleware catches them, fetches the MCP UI resource, and emits the activity event.

## Why a separate Python endpoint?

The unified Langroid `/` endpoint pre-binds `ALL_TOOLS` from `agents.agent` (weather, query_data, schedule_meeting, ...). MCP-Apps wants the **runtime-supplied** tool catalog, not those local tools. Splitting it into `/mcp-apps` keeps the tool surface clean and avoids the model accidentally calling a langroid tool when it should be drawing in Excalidraw.
