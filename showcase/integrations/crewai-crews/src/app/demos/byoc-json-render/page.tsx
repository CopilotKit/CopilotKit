"use client";

/**
 * BYOC json-render demo.
 *
 * Scenario: user asks for a sales-dashboard-style UI; the CrewAI crew
 * emits a JSON spec shaped like `{ root, elements }`, and
 * `@json-render/react` renders it against a Zod-validated catalog of
 * three components (MetricCard, BarChart, PieChart).
 *
 * Structurally mirrors the byoc-hashbrown demo so the two dashboard rows
 * are directly comparable - the only substantive difference is the
 * message renderer (this file swaps in `JsonRenderAssistantMessage`).
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatAssistantMessage,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { JsonRenderAssistantMessage } from "./json-render-renderer";
import { BYOC_JSON_RENDER_SUGGESTIONS } from "./suggestions";

const AGENT_ID = "byoc_json_render";

export default function ByocJsonRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-byoc-json-render" agent={AGENT_ID}>
      <div
        data-testid="byoc-json-render-root"
        className="flex justify-center items-center h-screen w-full"
      >
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // @canonical: pill exercises catalog message — see showcase/aimock/_canonical-catalog.json
  // Last entry matches the aimock fixture in showcase/aimock/d5-all.json
  // so the local stack renders deterministically without a real LLM call.
  useConfigureSuggestions({
    suggestions: [
      ...BYOC_JSON_RENDER_SUGGESTIONS.map((s) => ({
        title: s.label,
        message: s.prompt,
      })),
      {
        title: "Marketing overview",
        message: "outline a marketing overview with traffic breakdown",
      },
    ],
    available: "always",
  });

  const messageView = {
    assistantMessage:
      JsonRenderAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
  };

  return (
    <CopilotChat
      agentId={AGENT_ID}
      className="h-full rounded-2xl"
      messageView={messageView}
    />
  );
}
