# MCP Apps

## What This Demo Shows

A Claude Agent SDK (Python) agent backed by a remote MCP server that exposes tools **with UI**. When the agent calls an MCP tool, CopilotKit fetches the associated UI resource and renders it as a sandboxed iframe inline in the chat.

This cell points at the public Excalidraw MCP app.

## How to Interact

Try asking your Copilot to:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and database."

The agent calls a single MCP tool (`create_view`) and the resulting Excalidraw board appears as an iframe inside the chat bubble.

## Technical Details

What's happening technically:

- **MCP Apps** are MCP servers that return UI resources alongside tool results. CopilotKit ships built-in middleware that recognizes these resources and emits `activity` events for them.
- The **runtime** configures `mcpApps: { servers: [...] }` (see `src/app/api/copilotkit-mcp-apps/route.ts`). This auto-applies the MCP Apps middleware to every registered agent and exposes the remote server's tools to the agent at request time by appending them to the AG-UI request's `tools` array.
- The **agent** has no bespoke tools (see `src/agents/mcp_apps_agent.py`). It owns its own streaming loop that forwards `input_data.tools` (the MCP-injected tools) straight to the Anthropic Messages API and streams Claude's `tool_use` blocks back as AG-UI `TOOL_CALL_*` events. The MCP Apps middleware on the runtime layer intercepts each call, fetches the UI resource, and emits the activity event — no server-side tool execution loop needed.
- The **frontend** needs no activity renderer — `CopilotKitProvider` auto-registers the built-in `MCPAppsActivityRenderer` for the `mcp-apps` activity type, so a plain `<CopilotChat />` is enough.

## Configuration

`mcpApps` config lives in `src/app/api/copilotkit-mcp-apps/route.ts`:

```ts
const runtime = new CopilotRuntime({
  agents: { "mcp-apps": mcpAppsAgent },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
        serverId: "excalidraw",
      },
    ],
  },
});
```

Always pin a stable `serverId`. Without it CopilotKit hashes the URL, and a URL change silently breaks restoration of persisted MCP Apps in prior conversation threads.

## Building With This

The Claude Agent SDK backend mounts the dedicated MCP Apps endpoint as a sub-path on the same FastAPI app:

```python
# src/agent_server.py
@app.post("/mcp-apps")
async def mcp_apps_endpoint(request: Request) -> StreamingResponse:
    body = await request.json()
    input_data = RunAgentInput(**body)
    ...
```

Because the dedicated endpoint runs in the same process as the shared agent, it shares the `ANTHROPIC_API_KEY` env var and the global health/CORS middleware — no extra wiring required.
