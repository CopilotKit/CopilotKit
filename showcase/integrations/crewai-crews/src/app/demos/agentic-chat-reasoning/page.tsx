"use client";

// Agentic Chat (Reasoning) — overrides the `reasoningMessage` slot to
// emphasize the agent's thinking chain.

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
  // @canonical: pill exercises catalog message — see showcase/aimock/_canonical-catalog.json
  // Single-click prompt matches the aimock fixture in
  // showcase/aimock/d5-all.json so the local stack renders deterministically.
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
