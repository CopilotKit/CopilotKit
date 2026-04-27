# Agent implementation for MCP Apps demo
# The LlamaIndex backend is defined in src/agents/mcp_apps_agent.py and
# mounted under /mcp-apps on the agent_server. The MCP tools are injected
# by the Next.js runtime's mcpApps middleware at request time, so the
# backend agent has no bespoke tools.
