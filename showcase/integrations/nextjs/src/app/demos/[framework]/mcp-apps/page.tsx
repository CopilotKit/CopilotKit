"use client";

/**
 * MCP Apps demo (unified nextjs port).
 *
 * MCP Apps are MCP servers that expose tools with associated UI resources.
 * The CopilotKit runtime is wired with `mcpApps: { servers: [...] }`
 * (see the matching api/[framework]/mcp-apps route), which auto-applies the
 * MCP Apps middleware. When the agent calls an MCP tool, the middleware
 * fetches the associated UI resource and emits an activity event; the
 * built-in `MCPAppsActivityRenderer` registered by `CopilotKitProvider`
 * renders the sandboxed iframe inline in the chat.
 *
 * Reference (strands legacy):
 * showcase/integrations/strands/src/app/demos/mcp-apps/page.tsx
 */

import React, { use } from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

const DEMO_ID = "mcp-apps";

export default function MCPAppsDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  // @region[no-frontend-renderer-needed]
  // No `renderActivityMessages`, no `useRenderActivityMessage` — the
  // CopilotKitProvider auto-registers the built-in `MCPAppsActivityRenderer`
  // for the "mcp-apps" activity type. A plain <CopilotChat /> is enough.
  return (
    <CopilotKit runtimeUrl={`/api/${framework}/${DEMO_ID}`} agent={DEMO_ID}>
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
    ],
    available: "always",
  });

  return <CopilotChat agentId={DEMO_ID} className="h-full rounded-2xl" />;
}
