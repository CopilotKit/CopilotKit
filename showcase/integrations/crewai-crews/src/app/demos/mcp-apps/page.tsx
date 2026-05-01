"use client";

/**
 * MCP Apps demo (CrewAI Crews).
 *
 * MCP Apps are MCP servers that expose tools with associated UI resources.
 * The CopilotKit runtime is wired with `mcpApps: { servers: [...] }`
 * (see `src/app/api/copilotkit-mcp-apps/route.ts`), which auto-applies the
 * MCP Apps middleware. When the agent calls an MCP tool, the middleware
 * fetches the associated UI resource and emits an activity event; the
 * built-in `MCPAppsActivityRenderer` registered by `CopilotKitProvider`
 * renders the sandboxed iframe inline in the chat -- no app-side renderer
 * registration required.
 *
 * This cell points at the public Excalidraw MCP app (https://mcp.excalidraw.com)
 * and is backed by a no-tools CrewAI crew at `${AGENT_URL}/mcp-apps`.
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/crewai-crews/generative-ui/mcp-apps
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function MCPAppsDemo() {
  // @region[no-frontend-renderer-needed]
  // No `renderActivityMessages`, no `useRenderActivityMessage` -- the
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
  // @canonical: pill exercises catalog message — see showcase/aimock/_canonical-catalog.json
  // Last entry matches the aimock fixture in showcase/aimock/d5-all.json
  // so the local stack renders deterministically without a real LLM call.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Draw a flowchart",
        message: "Use Excalidraw to draw a simple flowchart with three steps.",
      },
      {
        title: "Sketch a system diagram",
        message:
          "Open Excalidraw and sketch a system diagram with a client, server, and database.",
      },
      {
        title: "Excalidraw",
        message: "draw an excalidraw diagram of a router with two switches",
      },
    ],
    available: "always",
  });

  return <CopilotChat agentId="mcp-apps" className="h-full rounded-2xl" />;
}
