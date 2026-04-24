# QA: MCP Apps — Spring AI

## Prerequisites

- Spring AI backend is up
- NextJS runtime can reach `https://mcp.excalidraw.com` (or configured MCP_SERVER_URL)

## Test Steps

- [ ] Navigate to `/demos/mcp-apps`
- [ ] Click "Draw a flowchart"
- [ ] Verify the agent invokes an MCP tool and the Excalidraw UI resource appears inline as a sandboxed iframe

## Expected Results

- `mcpApps.servers` on the runtime auto-adds MCP tools to the forwarded tool list
- Agent calls an MCP tool; middleware emits the activity event with the fetched UI resource
- Built-in `MCPAppsActivityRenderer` renders the iframe

## Known gaps

- If the `ag-ui:spring-ai` adapter does not forward the runtime-injected MCP tools through to the Spring ChatClient's tool-calling surface, the agent will not invoke them. In that case the activity event is never emitted and the iframe does not render; see PARITY_NOTES.md for context.
