"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

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
  // Canonical e2e suggestion — exact catalog match for tool-rendering-reasoning-chain.
  // See showcase/aimock/_canonical-catalog.json (frozen).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Kyoto itinerary",
        message: "draft a 3-day kyoto itinerary with a 1500 dollar budget",
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
