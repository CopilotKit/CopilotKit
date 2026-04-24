# QA: MCP Apps — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/mcp-apps` on the dashboard host
- Agent backend is healthy; `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the `mcp_apps` graph (registered as agent name `mcp-apps` — see `src/app/api/copilotkit-mcp-apps/route.ts`)
- MCP server target: the public Excalidraw MCP app at `https://mcp.excalidraw.com` (override via `MCP_SERVER_URL`). Pinned `serverId: "excalidraw"` so URL changes don't silently break persisted activities
- Note: the demo source contains no `data-testid` attributes and registers no custom activity renderer — CopilotKit's built-in `MCPAppsActivityRenderer` handles the sandboxed iframe automatically. Checks below rely on verbatim visible text, network traffic, and the iframe DOM

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/mcp-apps`; verify the page renders within 3s and a single `CopilotChat` pane is centered (max-width ~896px, rounded-2xl, full-height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-mcp-apps"` and `agent="mcp-apps"` (DevTools → Network: sending a message hits that endpoint)
- [ ] Verify both suggestion pills are visible with verbatim titles:
  - "Draw a flowchart"
  - "Sketch a system diagram"
- [ ] Send "Hello" and verify an assistant text response appears within 10s (no MCP activity iframe for plain text)

### 2. Feature-Specific Checks

#### MCP Server Connection (runtime `mcpApps.servers`)

- [ ] Send the first flow-chart prompt; in DevTools → Network, verify the POST to `/api/copilotkit-mcp-apps` succeeds (status 200) and the server-side runtime resolves tools from `https://mcp.excalidraw.com` (watch the server logs for the MCP Apps middleware attaching the Excalidraw tool set — notably `create_view`)
- [ ] Verify no console errors mentioning the MCP server URL, auth, or tool-schema parse failures

#### MCP Tool Invocation (`create_view`)

- [ ] Click "Draw a flowchart"; within 60s verify the agent calls the `create_view` MCP tool exactly ONCE (per `SYSTEM_PROMPT` in `src/agents/mcp_apps_agent.py`: "Call `create_view` ONCE with 3-5 elements total") — confirm via DevTools → Network stream or backend logs
- [ ] Verify the tool payload contains 3-5 Excalidraw elements (shapes + arrows + optional title text), each with a unique string `id`, and ends with ONE `cameraUpdate` sized `600x450` or `800x600`

#### Activity Renderer (built-in `MCPAppsActivityRenderer`)

- [ ] Within 60s of the tool call, verify a sandboxed `<iframe>` renders inline in the chat transcript (activity-message slot) pointed at the Excalidraw MCP UI resource
- [ ] Verify the iframe has a `sandbox` attribute (CopilotKit's built-in renderer always sandboxes MCP UI resources)
- [ ] Verify the iframe paints a flow-chart-shaped diagram: at least 3 shape nodes (rectangles, ellipses, or diamonds with text labels) connected by arrows, framed within the viewport (camera-update step from the system prompt)
- [ ] Verify the assistant text below the iframe is a single short sentence describing what was drawn (per system prompt)

#### Server-Driven UI Update (second prompt, same thread)

- [ ] Without reloading, send the second suggestion "Sketch a system diagram"; within 60s verify a new activity iframe renders in-transcript containing a client → server → database layout (3 labeled shapes + 2 arrows)
- [ ] Verify the previous flow-chart iframe is still present and un-stale in the scrollback (activity messages persist, matching the rationale for the pinned `serverId: "excalidraw"` in the runtime config)

#### End-to-End MCP Interaction (concrete, single-case)

- [ ] Send an explicit prompt: `"Use Excalidraw to draw exactly 2 rectangles labelled 'A' and 'B' connected by one arrow from A to B."`
- [ ] Within 60s verify: (1) `create_view` is called ONCE with exactly 3 elements (2 rectangles + 1 arrow) plus the trailing `cameraUpdate`; (2) an iframe renders showing two labelled rectangles with a connecting arrow; (3) the assistant reply is one short sentence; (4) no duplicate `create_view` invocations or retries appear in network / logs

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Send "What is 2+2?"; verify the agent replies in plain text without invoking `create_view` (no iframe, no MCP activity in the stream)
- [ ] DevTools → Console: walk through all flows above; verify no uncaught errors, no CORS failures referencing `mcp.excalidraw.com`, and no "sandbox" / iframe-permission warnings

## Expected Results

- Chat loads within 3s; plain-text response within 10s; MCP-backed iframe renders within 60s of prompt (bias is "correct-enough diagram fast" per system prompt, one `create_view` call)
- MCP server connection to `https://mcp.excalidraw.com` succeeds and the Excalidraw tool set (including `create_view`) is advertised to the agent at request time
- At least one concrete end-to-end MCP interaction completes: user prompt → `create_view` tool call → activity event → sandboxed iframe painting the requested diagram
- The built-in `MCPAppsActivityRenderer` is used (no app-side `useRenderActivityMessage` / `renderActivityMessages` registration exists in `page.tsx` — per the `@region[no-frontend-renderer-needed]` contract)
- No UI layout breaks, no uncaught console errors, no duplicate `create_view` invocations within a single prompt turn
