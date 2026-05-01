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
  useConfigureSuggestions({
    suggestions: [
      { title: "Get weather", message: "What's the weather in Tokyo?" },
      {
        title: "Find flights",
        message: "Find me flights from SFO to LAX next Tuesday.",
      },
      {
        title: "Sales chart",
        message: "Show me a quarterly revenue pie chart.",
      },
      // @region[canonical-e2e-suggestion]
      // Canonical e2e suggestion — single pill keyed to the aimock fixture in
      // showcase/aimock/d5-all.json (see showcase/aimock/_canonical-catalog.json).
      {
        title: "Default catchall",
        message: "trigger the default catchall renderer for an unmapped tool",
      },
      // @endregion[canonical-e2e-suggestion]
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
