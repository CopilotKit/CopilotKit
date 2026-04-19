"use client";

/**
 * Declarative Generative UI (A2UI) — primary / minimal demo.
 *
 * This is the canonical "injectA2UITool only" pattern:
 * - The runtime has `a2ui: { injectA2UITool: true, agents: [...] }`
 *   (see `./api/copilotkit/route.ts`).
 * - The frontend registers NO custom component catalog — the A2UI renderer
 *   falls back to the built-in `basicCatalog` (Text, Image, Row, Column,
 *   Card, Button, List, Tabs, TextField, CheckBox, Slider, Modal, …).
 * - The agent (see `backend/agent.py`) uses a secondary LLM to emit an
 *   A2UI component tree at runtime, against the basic catalog schema that
 *   the middleware injects as `copilotkit.context`.
 *
 * For the "bring your own catalog" variant (branded Card/Metric/PrimaryButton
 * renderers), see the sibling cell `declarative-gen-ui-hardcoded`.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 *   https://docs.copilotkit.ai/docs/snippets/shared/generative-ui/a2ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function DeclarativeGenUIDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="declarative-gen-ui">
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
        title: "Show me a welcome card",
        message:
          "Show me a welcome card with a title, a short description, and a primary button.",
      },
      {
        title: "Render a simple form",
        message:
          "Render a feedback form with a name field, a rating slider, and a submit button.",
      },
      {
        title: "List a few items",
        message:
          "Show me a list of three book recommendations with titles and authors.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
