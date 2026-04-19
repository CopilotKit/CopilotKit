"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

// Outer layer — provider + layout chrome.
export default function AgenticChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic-chat">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// The actual view — just the chat.
function Chat() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
    ],
    available: "always",
  });

  return <CopilotChat agentId="agentic-chat" className="h-full rounded-2xl" />;
}
