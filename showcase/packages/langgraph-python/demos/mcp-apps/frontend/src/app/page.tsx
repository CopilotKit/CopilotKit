"use client";

/**
 * MCP Apps demo.
 *
 * MCP Apps are MCP servers that expose tools with associated UI resources.
 * When the agent calls one, CopilotKit auto-fetches and renders the UI
 * component in the chat via the built-in `MCPAppsActivityRenderer`.
 *
 * In this showcase cell we don't run a real MCP server — the TS route
 * (`api/copilotkit/route.ts`) installs an `MCPAppsStubMiddleware` that
 * (a) synthesizes an `ACTIVITY_SNAPSHOT` event when it sees the backend
 *     `show_mcp_app` tool call complete, and
 * (b) intercepts the follow-up `__proxiedMCPRequest` `resources/read` sent
 *     by the renderer on mount, returning a pre-baked HTML resource so the
 *     sandboxed iframe has something to show.
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  MCPAppsActivityRenderer,
  MCPAppsActivityContentSchema,
  MCPAppsActivityType,
  useConfigureSuggestions,
  useRenderActivityMessage,
  type ReactActivityMessageRenderer,
} from "@copilotkit/react-core/v2";

// Stable reference — `renderActivityMessages` must be a stable array.
const mcpAppsRenderer: ReactActivityMessageRenderer<
  typeof MCPAppsActivityContentSchema._type
> = {
  activityType: MCPAppsActivityType, // "mcp-apps"
  content: MCPAppsActivityContentSchema,
  render: MCPAppsActivityRenderer,
};

const activityRenderers: ReactActivityMessageRenderer<any>[] = [
  mcpAppsRenderer,
];

// Outer layer — provider registers the MCP Apps activity renderer so that
// when the agent emits an `activity` message with type "mcp-apps", the
// sandboxed MCP UI renders inline in the chat.
export default function MCPAppsDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="mcp-apps"
      renderActivityMessages={activityRenderers}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// The actual view — just the chat.
function Chat() {
  // Consume the activity-message rendering pipeline; CopilotChat uses this
  // internally to dispatch `activity` messages to the registered renderer.
  useRenderActivityMessage();

  useConfigureSuggestions({
    suggestions: [
      { title: "Show me an app", message: "Show me an MCP app." },
      {
        title: "What MCP apps are available?",
        message: "What MCP apps can you show me?",
      },
    ],
    available: "always",
  });

  return <CopilotChat agentId="mcp-apps" className="h-full rounded-2xl" />;
}
