"use client";

/**
 * MCP Apps demo.
 *
 * MCP Apps are MCP servers that expose tools with associated UI resources.
 * The CopilotKit runtime is wired with `mcpApps: { servers: [...] }`
 * (see `src/app/api/copilotkit-mcp-apps/route.ts`), which auto-applies the
 * MCP Apps middleware. When the agent calls an MCP tool, the middleware
 * fetches the associated UI resource and emits an activity event; the
 * built-in `MCPAppsActivityRenderer` registered by `CopilotKitProvider`
 * renders the sandboxed iframe inline in the chat — no app-side renderer
 * registration required.
 *
 * This cell points at the public Excalidraw MCP app (https://mcp.excalidraw.com).
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function MCPAppsDemo() {
  // @region[no-frontend-renderer-needed]
  // No `renderActivityMessages`, no `useRenderActivityMessage` — the
  // CopilotKitProvider auto-registers the built-in `MCPAppsActivityRenderer`
  // for the "mcp-apps" activity type. A plain <CopilotChat /> is enough.
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-mcp-apps" agent="mcp-apps">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
  // @endregion[no-frontend-renderer-needed]
}

function Chat() {
  // @canonical-suggestion-pill
  // Single canonical e2e pill — title + message come straight from
  // showcase/aimock/_canonical-catalog.json.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Excalidraw",
        message: "draw an excalidraw diagram of a router with two switches",
      },
    ],
    available: "always",
  });

  return <CopilotChat agentId="mcp-apps" className="h-full rounded-2xl" />;
}
