# MCP Apps

The runtime's `mcpApps.servers` config auto-applies the MCP Apps middleware:
the agent's tool palette is augmented at request time with the remote MCP
server's tools, and tool calls bound to UI resources stream back as
sandboxed iframe activity events.

- Runtime: `src/app/api/copilotkit-mcp-apps/route.ts` (separate basePath)
- Agent: `src/lib/factory/mcp-apps-factory.ts` (zero local tools)
- Frontend: plain `<CopilotChat />` — `MCPAppsActivityRenderer` is
  auto-registered by `CopilotKitProvider`.
