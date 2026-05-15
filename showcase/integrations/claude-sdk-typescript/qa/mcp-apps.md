# QA: MCP Apps — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (served via /api/copilotkit-mcp-apps)
- Excalidraw MCP server is reachable (https://mcp.excalidraw.com)

## Test Steps

- [ ] Navigate to /demos/mcp-apps
- [ ] Click the "Draw a flowchart" suggestion
- [ ] Verify the MCP middleware fetches the Excalidraw UI resource
- [ ] Verify the `MCPAppsActivityRenderer` mounts a sandboxed iframe inline in chat
- [ ] Verify you can interact with the Excalidraw sandbox
- [ ] Verify no console errors

## Expected Results

- Inline MCP app iframe renders with working Excalidraw surface
- No UI errors
