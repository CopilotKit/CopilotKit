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
    // @region[provider-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
    // @endregion[provider-setup]
  );
}

// The actual view — just the chat.
// @region[chat-component]
function Chat() {
  // @region[configure-suggestions]
  useConfigureSuggestions({
    suggestions: [
      // canonical e2e pill — see showcase/aimock/_canonical-catalog.json
      { title: "Goldfish name", message: "good name for a goldfish" },
    ],
    available: "always",
  });
  // @endregion[configure-suggestions]

  // @region[render-chat]
  return <CopilotChat agentId="agentic_chat" className="h-full rounded-2xl" />;
  // @endregion[render-chat]
}
// @endregion[chat-component]
