"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

// Outer layer — provider + layout chrome.
export default function PrebuiltChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt-chat">
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
    suggestions: [{ title: "Say hi", message: "Say hi!" }],
    available: "always",
  });

  return <CopilotChat agentId="prebuilt-chat" className="h-full rounded-2xl" />;
}
