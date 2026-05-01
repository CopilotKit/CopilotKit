"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat_reasoning">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  // Canonical e2e suggestion — exact catalog match for agentic-chat-reasoning.
  // See showcase/aimock/_canonical-catalog.json (frozen).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show reasoning",
        message: "show your reasoning step by step",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full bg-slate-50">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="agentic_chat_reasoning"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}
