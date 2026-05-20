"""
Agent implementation for MCP Apps.

See ``src/agents/src/mcp_apps_agent.py`` for the actual graph wired into
``langgraph.json`` as ``mcp_apps``. The dedicated runtime at
``src/app/api/copilotkit-mcp-apps/route.ts`` configures ``mcpApps.servers``
pointing at the public Excalidraw MCP server — the runtime auto-applies
the MCP Apps middleware, which exposes the remote MCP server's tools to
the agent and emits the activity events that CopilotKit's built-in
``MCPAppsActivityRenderer`` renders as sandboxed iframes.
"""
