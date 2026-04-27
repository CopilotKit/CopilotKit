"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";

export default function ToolRenderingDefaultCatchallDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="tool_rendering_default_catchall">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Get weather", message: "What's the weather in Tokyo?" },
      { title: "Find flights", message: "Find me flights from SFO to LAX next Tuesday." },
      { title: "Sales chart", message: "Show me a quarterly revenue pie chart." },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full bg-gray-50">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="tool_rendering_default_catchall"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}
