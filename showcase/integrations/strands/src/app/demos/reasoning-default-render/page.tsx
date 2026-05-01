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

function ConfiguredChat() {
  useConfigureSuggestions({
    suggestions: [
      // canonical e2e pill — see showcase/aimock/_canonical-catalog.json
      {
        title: "Default reasoning",
        message: "talk me through your default reasoning on a tricky riddle",
      },
    ],
    available: "always",
  });
  return (
    <CopilotChat
      agentId="reasoning-default-render"
      className="h-full rounded-2xl"
    />
  );
}

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning-default-render">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <ConfiguredChat />
          {/* @endregion[default-reasoning-zero-config] */}
        </div>
      </div>
    </CopilotKit>
  );
}
