# MCP Apps

## What This Demo Shows

MCP server-driven UI rendered inline in the chat via activity events. The
runtime is wired with `mcpApps: { servers: [...] }` pointing at a public
MCP server (Excalidraw); the runtime auto-applies the MCP Apps middleware,
which exposes the remote MCP server's tools to the agent and emits the
activity events that CopilotKit's built-in `MCPAppsActivityRenderer`
renders as a sandboxed iframe.

## How to Interact

Try asking your Copilot to:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and
  database."

The agent calls the `create_view` MCP tool; the iframe renders the diagram
inline in the transcript.

## Technical Details

What's happening technically:

- The Next.js runtime route at `src/app/api/copilotkit-mcp-apps/route.ts`
  configures `mcpApps.servers` with the public Excalidraw MCP server.
- The LlamaIndex backend agent (`src/agents/mcp_apps_agent.py`) declares
  no bespoke tools — the MCP middleware injects the remote server's tools
  into each request automatically.
- The `CopilotKitProvider` auto-registers the built-in
  `MCPAppsActivityRenderer` for the `"mcp-apps"` activity type, so the
  page only needs a plain `<CopilotChat />`.
- This is the canonical pattern for plugging any MCP server with UI
  resources into a CopilotKit chat — no app-side renderer registration
  required.
