"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";

export default function ToolRenderingReasoningChainDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool_rendering_reasoning_chain"
    >
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather then flight",
        message:
          "Check the weather in Tokyo, then find me flights there from SFO if it looks nice.",
      },
      {
        title: "Multi-step planning",
        message:
          "Plan a quick getaway: pick a destination, check the weather, then suggest 2-3 flights.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full bg-gradient-to-br from-slate-50 to-purple-50">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="tool_rendering_reasoning_chain"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}
