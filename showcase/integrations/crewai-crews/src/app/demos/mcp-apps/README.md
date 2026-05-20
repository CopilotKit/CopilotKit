# MCP Apps (CrewAI Crews)

A no-tools CrewAI crew backed by a remote MCP server (Excalidraw) that exposes tools **with UI**. The CopilotKit runtime configures `mcpApps.servers` in `src/app/api/copilotkit-mcp-apps/route.ts`; its middleware injects the MCP-provided tools at request time and emits activity events that the built-in `MCPAppsActivityRenderer` renders as a sandboxed iframe inline in the chat.

Backend: `src/agents/mcp_apps_agent.py` (no Pydantic `BaseTool` wired -- the middleware does the injection). Mounted at `/mcp-apps` in `src/agent_server.py`.

Reference: https://docs.copilotkit.ai/integrations/crewai-crews/generative-ui/mcp-apps
