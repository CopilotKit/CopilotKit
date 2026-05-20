"use client";

// Reasoning (Default Render) demo.
//
// Backend emits AG-UI REASONING_MESSAGE_* events (same as reasoning-agent).
// This page passes NO custom `reasoningMessage` slot, so CopilotKit's built-in
// `CopilotChatReasoningMessage` renders the reasoning as a collapsible card.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning-default-render">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Single-click prompt that exercises the default reasoning slot. Wording
  // matches the aimock fixture in showcase/aimock/d5-all.json so the local
  // stack renders deterministically without a real LLM call.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show reasoning",
        message: "show your reasoning step by step",
      },
    ],
    available: "always",
  });

  // @region[default-reasoning-zero-config]
  return (
    <CopilotChat
      agentId="reasoning-default-render"
      className="h-full rounded-2xl"
    />
  );
  // @endregion[default-reasoning-zero-config]
}
