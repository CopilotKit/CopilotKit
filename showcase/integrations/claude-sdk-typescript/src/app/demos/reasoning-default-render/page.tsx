"use client";

// Reasoning (Default Render) demo.
//
// Backend (Claude agent_server `/reasoning`) enables Anthropic extended
// thinking and forwards `thinking_delta` events as AG-UI REASONING_MESSAGE_*
// events. This page passes NO custom `reasoningMessage` slot, so CopilotKit's
// built-in `CopilotChatReasoningMessage` renders the reasoning as a
// collapsible card.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-reasoning"
      agent="reasoning-default-render"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <Chat />
          {/* @endregion[default-reasoning-zero-config] */}
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
