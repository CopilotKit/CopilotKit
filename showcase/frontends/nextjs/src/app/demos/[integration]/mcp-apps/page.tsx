"use client";

/**
 * MCP Apps demo.
 *
 * MCP Apps are MCP servers that expose tools with associated UI resources.
 * The CopilotKit runtime is wired with `mcpApps: { servers: [...] }`
 * (see `src/demo-runtime-options.ts`), which auto-applies the MCP Apps
 * middleware. When the agent calls an MCP tool, the middleware fetches the
 * associated UI resource and emits an activity event. The built-in
 * `MCPAppsActivityRenderer` registered by `CopilotKitProvider` renders the
 * sandboxed iframe inline in the chat. No app-side renderer registration
 * is required.
 *
 * By default, this cell points at the public Excalidraw MCP app
 * (https://mcp.excalidraw.com). MCP_SERVER_URL sets another server.
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { Chat } from "./chat";

export default function MCPAppsDemo() {
  // @region[no-frontend-renderer-needed]
  // No `renderActivityMessages`, no `useRenderActivityMessage`: the
  // CopilotKitProvider auto-registers the built-in `MCPAppsActivityRenderer`
  // for the "mcp-apps" activity type. A plain <CopilotChat /> is enough.
  return (
    <CopilotKit runtimeUrl={useDemoRuntimeUrl("mcp-apps")} agent="mcp-apps">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
  // @endregion[no-frontend-renderer-needed]
}
