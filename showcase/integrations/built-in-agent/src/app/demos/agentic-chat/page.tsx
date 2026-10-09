"use client";

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { useAgenticChatSuggestions } from "./suggestions";

export default function AgenticChatDemo() {
  return (
    // @region[provider-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat">
      <Chat />
    </CopilotKit>
    // @endregion[provider-setup]
  );
}

// @region[chat-component]
function Chat() {
  useAgenticChatSuggestions();
  // @region[render-chat]
  return <CopilotChat agentId="agentic_chat" />;
  // @endregion[render-chat]
}
// @endregion[chat-component]
