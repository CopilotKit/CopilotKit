# MCP Apps

## What This Demo Shows

A CopilotKit chat connected to an MCP (Model Context Protocol) server whose tools come with associated **UI resources**. When the agent calls one of those tools, CopilotKit renders the server-provided UI inline in the chat as a sandboxed iframe — no app-side renderer registration needed.

## How to Interact

Try asking your Copilot to:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and database."

The agent will call the MCP server's drawing tool. CopilotKit's built-in `MCPAppsActivityRenderer` picks up the resulting `activity` event and renders the MCP server's UI (the Excalidraw canvas) as a sandboxed iframe inside the chat.

## Technical Details

What's happening technically:

- **.NET agent backend** — `agent/McpAppsAgent.cs` exposes a plain `ChatClientAgent` with **no bespoke tools**, mounted at `/mcp-apps` via `Program.cs`. All tools come from the remote MCP server via runtime middleware.
- **Runtime config** — `src/app/api/copilotkit-mcp-apps/route.ts` creates a dedicated `CopilotRuntime` with `mcpApps: { servers: [{ type: "http", url: MCP_SERVER_URL, serverId: "mcp_apps_server" }] }`. The runtime auto-applies the MCP Apps middleware to every registered agent.
- **Middleware behavior** — at request time the middleware fetches the remote MCP server's tool list and exposes those tools to the agent. When the agent calls one, the middleware fetches the associated UI resource and emits an `activity` event carrying it.
- **Built-in renderer** — `CopilotKitProvider` auto-registers `MCPAppsActivityRenderer` which consumes the `activity` event and renders the UI resource as a sandboxed iframe inline in the chat.
- **Server ID pinning** — `serverId: "mcp_apps_server"` is a stable id; without it CopilotKit hashes the URL, and a URL change silently breaks restoration of persisted MCP Apps in prior conversation threads.

## Configuration

- `MCP_SERVER_URL` — HTTP MCP server URL. Defaults to `https://mcp.excalidraw.com`.
- `AGENT_URL` — .NET agent base URL. Defaults to `http://localhost:8000`.

## Building With This

- **No frontend renderer required.** The built-in `MCPAppsActivityRenderer` handles the iframe rendering. You do not need `useRenderActivityMessage` or any custom activity handler for basic MCP Apps use.
- **Dedicated runtime route.** MCP Apps config lives on the runtime, not the agent. Give it its own `/api/copilotkit-*` route so it can evolve separately from the main chat runtime.
- **Keep the agent's tool set empty on the backend.** Tools come from the MCP server via middleware — don't duplicate them as bespoke agent tools.

Reference: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
