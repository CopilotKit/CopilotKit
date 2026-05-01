"use client";

// Reasoning (Default Render) demo.
// Backend emits REASONING_MESSAGE_* events; CopilotKit's built-in
// `CopilotChatReasoningMessage` renders them as a collapsible card.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

function CanonicalSuggestion() {
  // @canonical: pill exercises catalog message — see showcase/aimock/_canonical-catalog.json
  // Single-click prompt matches the aimock fixture in
  // showcase/aimock/d5-all.json so the local stack renders deterministically.
  useConfigureSuggestions({
    suggestions: [
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
    <CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning-default-render">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <CanonicalSuggestion />
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
