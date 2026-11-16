# MCP Apps

## What This Demo Shows

A chat connected to an MCP server whose tools come with UI resources. When the agent calls one of those tools, the chat shows the UI of the server in a sandboxed iframe. The page registers no renderer for it.

## How to Interact

Click a suggestion, or type a prompt. For example:

- "Use Excalidraw to draw a simple flowchart with three steps."
- "Open Excalidraw and sketch a system diagram with a client, server, and database."

The agent calls the drawing tool of the MCP server, and the Excalidraw canvas shows in the chat.

## Technical Details

- The runtime options of this demo set `mcpApps.servers` (see `src/demo-runtime-options.ts`). The runtime then applies the MCP Apps middleware to the agent.
- For each request, the middleware gives the tools of the MCP server to the agent. When the agent calls one of them, the middleware fetches the UI resource of the tool and emits an `activity` event.
- `CopilotKitProvider` registers the built-in `MCPAppsActivityRenderer`. It renders the UI resource as a sandboxed iframe in the chat, so a plain `<CopilotChat />` is enough.

## Configuration

- `MCP_SERVER_URL`: the URL of the HTTP MCP server. The default is `https://mcp.excalidraw.com`.
- `serverId`: a fixed id for the server ("excalidraw"). Without it, CopilotKit makes the id from the URL, and a new URL breaks the MCP Apps in earlier threads.

Reference: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
