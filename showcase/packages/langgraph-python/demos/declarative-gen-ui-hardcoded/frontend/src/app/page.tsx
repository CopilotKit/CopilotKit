"use client";

/**
 * Declarative Generative UI (A2UI — Dynamic Schema) demo.
 *
 * The agent (see `backend/agent.py`) emits an `a2ui_operations` payload at
 * runtime — it *designs* the component tree on the fly using a secondary LLM
 * with `bind_tools([render_a2ui], tool_choice="render_a2ui")`. The runtime's
 * A2UI middleware (`a2ui: { injectA2UITool: true }` in
 * `api/copilotkit/route.ts`) detects the operations and forwards them to the
 * frontend, where they render against the `demoCatalog` below.
 *
 * The catalog (`./catalog.tsx`) declares a small set of React components
 * (Card, Title, Metric, PrimaryButton) plus the built-in basic catalog. The
 * agent sees this catalog as context and picks from it when composing a
 * surface.
 *
 * Reference: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { demoCatalog } from "./catalog";

export default function DeclarativeGenUIDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="declarative-gen-ui-hardcoded"
      a2ui={{ catalog: demoCatalog }}
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
    <CopilotChat
      agentId="declarative-gen-ui-hardcoded"
      className="h-full rounded-2xl"
    />
  );
}
