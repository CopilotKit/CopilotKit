"use client";

/**
 * BYOC json-render demo (unified nextjs shell, Wave 2).
 *
 * The Strands agent emits a JSON spec shaped like { root, elements }, and
 * @json-render/react renders it against a Zod-validated catalog of three
 * components (MetricCard, BarChart, PieChart).
 *
 * The system prompt is baked into the dedicated backend factory
 * (src/agents/byoc_json_render.py). No frontend prompt injection needed.
 */

import React, { use } from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatAssistantMessage,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { JsonRenderAssistantMessage } from "./json-render-renderer";
import { BYOC_JSON_RENDER_SUGGESTIONS } from "./suggestions";

const DEMO_ID = "byoc-json-render";

export default function ByocJsonRenderDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    <CopilotKit runtimeUrl={`/api/${framework}/${DEMO_ID}`} agent={DEMO_ID}>
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
      agentId={DEMO_ID}
      className="h-full rounded-2xl"
      messageView={messageView}
    />
  );
}
