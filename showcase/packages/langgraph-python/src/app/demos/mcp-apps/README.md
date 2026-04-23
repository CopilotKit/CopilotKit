# MCP Apps

## What This Demo Shows

MCP Apps are MCP servers that expose tools _with_ associated UI resources. The agent has zero local tools — it talks to a remote MCP server (Excalidraw), and CopilotKit renders the server's UI inline as a sandboxed iframe.

- **Remote tools**: tools are fetched at request time from `https://mcp.excalidraw.com`
- **Auto-rendered UI**: the built-in `MCPAppsActivityRenderer` handles the iframe — no frontend renderer registration needed
- **Drawing agent**: the system prompt constrains output to a single `create_view` call with 3-5 Excalidraw elements

## How to Interact

Click a suggestion chip, or try:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and database."
- "Draw a sequence of boxes: Idea → Design → Build → Ship."

An Excalidraw canvas appears inline in the chat with the agent's drawing.

## Technical Details

- The runtime at `/api/copilotkit-mcp-apps` is configured with `mcpApps: { servers: [...] }`, which auto-applies the MCP Apps middleware. Tools and UI resources are discovered from the remote MCP server at request time.
- `src/agents/mcp_apps_agent.py` declares `tools=[]` — the middleware injects `create_view` (and siblings) from Excalidraw dynamically.
- The frontend is just `<CopilotKit runtimeUrl="/api/copilotkit-mcp-apps" agent="mcp-apps">` wrapping `<CopilotChat />`. The `CopilotKitProvider` ships with `MCPAppsActivityRenderer` pre-registered, so the iframe mounts automatically when the MCP tool call emits its UI resource event.
