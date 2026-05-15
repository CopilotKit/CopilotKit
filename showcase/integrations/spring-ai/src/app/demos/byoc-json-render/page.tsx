"use client";

/**
 * BYOC json-render demo.
 *
 * Scenario: user asks for a sales-dashboard-style UI; the Spring AI agent
 * emits a JSON spec shaped like `{ root, elements }`, and `@json-render/react`
 * renders it against a Zod-validated catalog of three components
 * (MetricCard, BarChart, PieChart).
 *
 * Structurally mirrors Wave 4a's hashbrown demo so the two dashboard rows
 * are directly comparable — the only substantive difference is the message
 * renderer (this file swaps in `JsonRenderAssistantMessage`).
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
    suggestions: BYOC_JSON_RENDER_SUGGESTIONS.map((s) => ({
      title: s.label,
      message: s.prompt,
    })),
    available: "always",
  });

  // `messageView.assistantMessage` replaces CopilotChat's default assistant
  // bubble. The cast mirrors the pattern used in `demos/chat-slots/page.tsx`
  // — the slot's prop shape is identical to `CopilotChatAssistantMessage`'s,
  // but TypeScript can't prove that through the WithSlots indirection.
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
