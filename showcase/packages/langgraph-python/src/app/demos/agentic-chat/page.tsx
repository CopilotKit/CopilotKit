"use client";

import React from "react";
import {
  useAgentContext,
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";

export default function AgenticChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  useAgentContext({
    description: "Name of the user",
    value: "Bob",
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Generate sonnet",
        message: "Write a short sonnet about AI.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat agentId="agentic_chat" className="h-full rounded-2xl" />
      </div>
    </div>
  );
}
