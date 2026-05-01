"use client";

// Agentic Chat (Reasoning) — overrides the reasoningMessage slot so the
// thinking chain is rendered as a visibly tagged amber banner instead of the
// default collapsible card. Backend reuses the shared Mastra weather agent
// (aliased as `agentic-chat-reasoning`) — if the underlying model emits
// reasoning tokens, they'll stream through AG-UI REASONING_MESSAGE_* events.

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  CopilotChatReasoningMessage,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { ReasoningBlock } from "./reasoning-block";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic-chat-reasoning">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Canonical e2e suggestion (see showcase/aimock/_canonical-catalog.json).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show reasoning",
        message: "show your reasoning step by step",
      },
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
