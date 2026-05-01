"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function ToolRenderingDefaultCatchallDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool_rendering_default_catchall"
    >
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // Canonical e2e suggestion — exact catalog match for tool-rendering-default-catchall.
  // See showcase/aimock/_canonical-catalog.json (frozen).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Default catchall",
        message: "trigger the default catchall renderer for an unmapped tool",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full bg-gray-50">
      <div className="h-full w-full max-w-4xl">
        {/* @region[default-catchall-zero-config] */}
        <CopilotChat
          agentId="tool_rendering_default_catchall"
          className="h-full rounded-2xl"
        />
        {/* @endregion[default-catchall-zero-config] */}
      </div>
    </div>
  );
}
