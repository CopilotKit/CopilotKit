"use client";

/**
 * MCP Apps demo.
 *
 * MCP Apps are MCP servers that expose tools with associated UI resources.
 * The CopilotKit runtime is wired with `mcpApps: { servers: [...] }` (see
 * `src/app/api/copilotkit-mcp-apps/route.ts`), which auto-applies the MCP
 * Apps middleware. When the agent calls an MCP tool, the middleware
 * fetches the associated UI resource and emits an activity event; the
 * built-in `MCPAppsActivityRenderer` registered by `CopilotKitProvider`
 * renders the sandboxed iframe inline in the chat.
 *
 * This cell points at the public Excalidraw MCP app
 * (https://mcp.excalidraw.com).
 */

import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";

export default function MCPAppsDemo() {
  // @region[no-frontend-renderer-needed]
  // No `renderActivityMessages`, no `useRenderActivityMessage` — the
  // CopilotKitProvider auto-registers the built-in `MCPAppsActivityRenderer`
  // for the "mcp-apps" activity type. A plain <CopilotChat /> is enough.
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit-mcp-apps" useSingleEndpoint>
      <main className="p-8">
        <h1 className="text-2xl font-semibold mb-4">MCP Apps</h1>
        <p className="text-sm opacity-70 mb-6">
          Try: &ldquo;Use Excalidraw to draw a simple flowchart with three
          steps.&rdquo; The agent invokes a remote MCP tool and the associated
          UI resource renders inline in chat.
        </p>
        <CopilotChat />
      </main>
    </CopilotKitProvider>
  );
  // @endregion[no-frontend-renderer-needed]
}
