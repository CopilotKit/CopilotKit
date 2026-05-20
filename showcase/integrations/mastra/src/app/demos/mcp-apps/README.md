# MCP Apps

## What This Demo Shows

MCP server-driven UI rendered inline via the runtime's `mcpApps` config and the built-in activity renderer.

## How to Interact

Try asking:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and database."

The Mastra agent calls a remote MCP tool (Excalidraw's `create_view`); the runtime fetches the UI resource and emits an activity event, which the built-in `MCPAppsActivityRenderer` renders as a sandboxed iframe inline in the chat.

## Technical Details

- `CopilotRuntime({ mcpApps: { servers: [...] } })` auto-applies MCP Apps middleware to every registered agent
- The agent itself defines no tools — MCP server tools are injected at request time
- The frontend renders nothing custom: `<CopilotChat />` plus the auto-registered `MCPAppsActivityRenderer` does the work
