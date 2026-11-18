"use client";

import React from "react";
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core";
import { useAgenticChatSuggestions } from "./suggestions";

export default function AgenticChatDemo() {
  return (
    // @region[provider-setup]
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="agentic_chat">
      <Chat />
    </CopilotKitProvider>
    // @endregion[provider-setup]
  );
}

function Chat() {
  useAgenticChatSuggestions();
  // @region[render-chat]
  return <CopilotChat agentId="agentic_chat" />;
  // @endregion[render-chat]
}
