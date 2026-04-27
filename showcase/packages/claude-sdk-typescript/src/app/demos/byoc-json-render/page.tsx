"use client";

/**
 * BYOC json-render demo — Claude Agent SDK (TypeScript) port.
 *
 * Scenario: user asks for a sales-dashboard-style UI; the Claude agent
 * emits a JSON spec shaped like `{ root, elements }`, and
 * `@json-render/react` renders it against a Zod-validated catalog of
 * three components (MetricCard, BarChart, PieChart).
 *
 * The Claude backend receives this request on its dedicated
 * `/byoc-json-render` endpoint, which swaps in a system prompt steering
 * Claude to emit the JSON envelope the renderer consumes.
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
