# MCP Apps (Strands)

## What This Demo Shows

CopilotKit's MCP Apps middleware lets a remote MCP server contribute both
tools AND associated UI resources to the agent at runtime. When the agent
calls one of those MCP tools, the middleware fetches the linked UI resource
and the built-in `MCPAppsActivityRenderer` paints it in the chat as a
sandboxed iframe.

This Strands variant points at the public Excalidraw MCP app
(`https://mcp.excalidraw.com`) so the model can produce lightweight diagrams
inline in the conversation.

## How to Interact

Try asking your Copilot to:

- "Draw a flowchart of a login flow with 3 steps"
- "Sketch a system diagram with a client, server, and database"
- "Make me a quick org chart with a CEO and three reports"

## Technical Details

- The dedicated runtime route at `src/app/api/copilotkit-mcp-apps/route.ts`
  configures `mcpApps.servers: [{ type: "http", url: ..., serverId: "excalidraw" }]`.
- The Strands agent itself has no bespoke MCP tools — the CopilotKit
  runtime middleware advertises the MCP server's tools to the agent for
  the duration of the request.
- The frontend registers no activity renderer; CopilotKit's built-in
  `MCPAppsActivityRenderer` handles the sandboxed iframe rendering for
  every emitted MCP UI resource.
- `serverId: "excalidraw"` is pinned so persisted threads can be restored
  even if the server URL changes — without an explicit serverId,
  CopilotKit hashes the URL and rotates it when the URL rotates.

See the canonical port for more context:
`showcase/integrations/langgraph-python/src/app/demos/mcp-apps/page.tsx`.
