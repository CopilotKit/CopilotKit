"use client";

/**
 * Declarative Generative UI (A2UI - Dynamic Schema) demo.
 *
 * The backend agent emits an `a2ui_operations` payload at runtime (the schema
 * is declared in the tool result, not in the frontend). The frontend wires up
 * an A2UI activity-message renderer so that payload renders into real
 * components via the default A2UI basicCatalog.
 *
 * Backend: src/agents/a2ui_dynamic.py (graph `a2ui_dynamic`). The reference
 * implementation uses a secondary LLM bound to a `render_a2ui` tool to
 * generate the schema; this showcase ships a placeholder fixed payload that
 * follows the same `a2ui_operations` wire format.
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
