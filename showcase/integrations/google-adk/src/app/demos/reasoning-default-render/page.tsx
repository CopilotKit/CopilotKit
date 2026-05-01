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
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Reason through",
        message: "Reason through whether a hot dog is a sandwich.",
      },
      {
        title: "Multi-step",
        message: "Walk me step-by-step through how to deduplicate a JS array.",
      },
      // @region[canonical-e2e-suggestion]
      // Canonical e2e suggestion — single pill keyed to the aimock fixture in
      // showcase/aimock/d5-all.json (see showcase/aimock/_canonical-catalog.json).
      {
        title: "Default reasoning",
        message: "talk me through your default reasoning on a tricky riddle",
      },
      // @endregion[canonical-e2e-suggestion]
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
