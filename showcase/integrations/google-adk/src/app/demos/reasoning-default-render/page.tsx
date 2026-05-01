"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning_default_render">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  // Canonical e2e suggestion — exact catalog match for reasoning-default-render.
  // See showcase/aimock/_canonical-catalog.json (frozen).
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
    <div className="flex justify-center items-center h-screen w-full bg-gray-50">
      <div className="h-full w-full max-w-4xl">
        {/* @region[default-reasoning-zero-config] */}
        <CopilotChat
          agentId="reasoning_default_render"
          className="h-full rounded-2xl"
        />
        {/* @endregion[default-reasoning-zero-config] */}
      </div>
    </div>
  );
}
