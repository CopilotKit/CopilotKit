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
