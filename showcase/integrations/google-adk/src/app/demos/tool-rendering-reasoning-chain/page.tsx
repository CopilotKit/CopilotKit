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
      // @region[canonical-e2e-suggestion]
      // Canonical e2e suggestion — single pill keyed to the aimock fixture in
      // showcase/aimock/d5-all.json (see showcase/aimock/_canonical-catalog.json).
      {
        title: "Kyoto itinerary",
        message: "draft a 3-day kyoto itinerary with a 1500 dollar budget",
      },
      // @endregion[canonical-e2e-suggestion]
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
