"use client";

// Agentic Chat (Reasoning).
//
// Backend (Claude agent_server `/reasoning`) enables Anthropic extended
// thinking. This page overrides the `reasoningMessage` slot to render the
// thinking chain in a tagged amber banner.

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
  // canonical e2e pill — see showcase/aimock/_canonical-catalog.json
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
