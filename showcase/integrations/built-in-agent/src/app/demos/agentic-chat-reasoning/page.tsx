"use client";

// Agentic Chat (Reasoning) — built-in-agent variant.
//
// The built-in tanstack/openai factory normally uses a non-reasoning
// model (gpt-4o) so REASONING_* events never flow. This demo points at
// a dedicated route (`/api/copilotkit-reasoning`) whose factory uses a
// reasoning-capable model (`gpt-5.2`) with `reasoning_effort: "low"`.
// The runtime's tanstack converter translates the upstream reasoning
// events into AG-UI REASONING_START / REASONING_MESSAGE_CONTENT /
// REASONING_END, and CopilotKit renders them via the
// `reasoningMessage` slot — overridden below for visual emphasis.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { ReasoningBlock } from "./reasoning-block";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-reasoning"
      agent="agentic-chat-reasoning"
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
      // canonical e2e pill — see showcase/aimock/_canonical-catalog.json
      { title: "Show reasoning", message: "show your reasoning step by step" },
    ],
    available: "always",
  });

  // @region[reasoning-block-render]
  return (
    <CopilotChat
      agentId="agentic-chat-reasoning"
      className="h-full rounded-2xl"
      messageView={{
        reasoningMessage: ReasoningBlock as typeof CopilotChatReasoningMessage,
      }}
    />
  );
  // @endregion[reasoning-block-render]
}
