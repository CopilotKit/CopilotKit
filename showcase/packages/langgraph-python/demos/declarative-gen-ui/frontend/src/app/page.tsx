"use client";

/**
 * Declarative Generative UI (A2UI — Dynamic Schema) demo.
 *
 * The backend agent (see `backend/agent.py`) emits an `a2ui_operations`
 * payload at runtime — the schema is declared in the tool result, not in
 * the frontend. The runtime's A2UI middleware (enabled via
 * `a2ui: { injectA2UITool: true }` in `api/copilotkit/route.ts`) detects
 * the operations and forwards them to the renderer below.
 *
 * The frontend just registers an A2UI activity-message renderer so the
 * payload turns into real components from the default A2UI `basicCatalog`.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/a2ui
 */

import React, { useMemo } from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
  createA2UIMessageRenderer,
  a2uiDefaultTheme,
} from "@copilotkit/react-core/v2";

export default function DeclarativeGenUIDemo() {
  // Memoize so the provider's stable-array check is satisfied across renders.
  const activityRenderers = useMemo(
    () => [createA2UIMessageRenderer({ theme: a2uiDefaultTheme })],
    [],
  );

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="declarative-gen-ui"
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

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show me a flight booking card",
        message: "Show me a flight booking card from SFO to JFK.",
      },
      {
        title: "Render a sales dashboard",
        message: "Render a dashboard with a few key metrics.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
