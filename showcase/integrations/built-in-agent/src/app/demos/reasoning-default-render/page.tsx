"use client";

// Reasoning (Default Render) — built-in-agent variant.
//
// Same backend (`/api/copilotkit-reasoning`, agent
// `reasoning-default-render`, gpt-5.2 with reasoning_effort=low) as the
// agentic-chat-reasoning demo, but this page passes NO custom
// `reasoningMessage` slot. CopilotKit's built-in
// `CopilotChatReasoningMessage` renders the chain as a collapsible card
// with a "Thinking…" / "Thought for X" header — the zero-config path.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

function ReasoningDefaultSuggestions() {
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
  return null;
}

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-reasoning"
      agent="reasoning-default-render"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <ReasoningDefaultSuggestions />
          <CopilotChat
            agentId="reasoning-default-render"
            className="h-full rounded-2xl"
          />
          {/* @endregion[default-reasoning-zero-config] */}
        </div>
      </div>
    </CopilotKit>
  );
}
