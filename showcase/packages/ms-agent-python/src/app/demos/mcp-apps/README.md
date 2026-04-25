# MCP Apps

## What This Demo Shows

A Microsoft Agent Framework agent backed by a remote MCP server that exposes tools **with UI**. When the agent calls an MCP tool, CopilotKit fetches the associated UI resource and renders it as a sandboxed iframe inline in the chat.

This cell points at the public Excalidraw MCP app.

## How to Interact

Try asking your Copilot to:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and database."

The agent calls a single MCP tool (e.g. `create_view`) and the resulting Excalidraw board appears as an iframe inside the chat bubble.

## Technical Details

What's happening technically:

- **MCP Apps** are MCP servers that return UI resources alongside tool results. CopilotKit ships built-in middleware that recognizes these resources and emits `activity` events for them.
- The **runtime** configures `mcpApps: { servers: [...] }` (see `src/app/api/copilotkit-mcp-apps/route.ts`). This auto-applies the MCP Apps middleware to every registered agent and exposes the remote server's tools to the agent at request time.
- The **agent** has no bespoke tools (see `src/agents/mcp_apps_agent.py`). Its system prompt tells it how to use the MCP-provided tools the middleware injects.
- The **frontend** needs no activity renderer -- `CopilotKitProvider` auto-registers the built-in `MCPAppsActivityRenderer` for the `mcp-apps` activity type, so a plain `<CopilotChat />` is enough.

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
        serverId: "mcp_apps_server",
      },
    ],
  },
});
```

Always pin a stable `serverId`. Without it CopilotKit hashes the URL, and a URL change silently breaks restoration of persisted MCP Apps in prior conversation threads.

## Building With This

The MS Agent backend mounts the dedicated MCP Apps agent on a sub-path:

```python
# src/agent_server.py
add_agent_framework_fastapi_endpoint(
    app=app,
    agent=mcp_apps_agent,
    path="/mcp-apps",
)
```

This sub-path MUST be mounted BEFORE the root (`/`) mount -- the root mount installs a catch-all that would otherwise shadow any subsequent mounts.
