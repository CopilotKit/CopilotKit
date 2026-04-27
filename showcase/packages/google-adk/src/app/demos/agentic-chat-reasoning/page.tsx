"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
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
