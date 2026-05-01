"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat_reasoning">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Logic puzzle",
        message:
          "If a train leaves Tokyo at 9:15 going 90km/h and another leaves Osaka at 9:45 going 110km/h, when do they meet given Tokyo and Osaka are 515km apart? Show your reasoning.",
      },
      {
        title: "Tradeoff analysis",
        message:
          "I have $5k. Should I invest in upgrading my work laptop or buying a course bundle? Reason through it.",
      },
      // @region[canonical-e2e-suggestion]
      // Canonical e2e suggestion — single pill keyed to the aimock fixture in
      // showcase/aimock/d5-all.json (see showcase/aimock/_canonical-catalog.json).
      {
        title: "Show reasoning",
        message: "show your reasoning step by step",
      },
      // @endregion[canonical-e2e-suggestion]
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full bg-slate-50">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="agentic_chat_reasoning"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}
