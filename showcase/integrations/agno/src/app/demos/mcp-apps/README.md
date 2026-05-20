# MCP Apps

## What This Demo Shows

MCP Apps are MCP servers that expose tools paired with UI resources. The
CopilotKit runtime is wired with `mcpApps: { servers: [...] }`; on every
MCP tool call the middleware fetches the matching UI resource and emits an
activity event that the built-in `MCPAppsActivityRenderer` renders inline
in the chat as a sandboxed iframe.

## How to Interact

Try asking your Copilot to:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and database."

## Technical Details

- Runtime: `src/app/api/copilotkit-mcp-apps/route.ts` — adds
  `mcpApps.servers` pointing at `https://mcp.excalidraw.com`.
- Agent: `src/agents/mcp_apps_agent.py` — an Agno agent with no native
  tools, so every visible tool call comes from the MCP server.
- Frontend: a plain `<CopilotChat />` — no app-side activity renderer
  registration needed; CopilotKit's provider auto-registers the built-in
  MCP Apps renderer.
