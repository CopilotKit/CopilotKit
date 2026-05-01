"use client";

// Reasoning (Default Render) demo.
//
// Backend emits AG-UI REASONING_MESSAGE_* events when the LLM produces
// reasoning content. This page passes NO custom `reasoningMessage` slot,
// so CopilotKit's built-in `CopilotChatReasoningMessage` renders the
// reasoning as a collapsible card — zero-config reasoning UI.

import React from "react";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";

function Chat() {
  // @region[configure-suggestions]
  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Default reasoning",
        message: "talk me through your default reasoning on a tricky riddle",
      },
    ],
    available: "always",
  });
  // @endregion[configure-suggestions]

  // @region[default-reasoning-zero-config]
  return (
    <CopilotChat
      agentId="reasoning-default-render"
      className="h-full rounded-2xl"
    />
  );
  // @endregion[default-reasoning-zero-config]
}

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
