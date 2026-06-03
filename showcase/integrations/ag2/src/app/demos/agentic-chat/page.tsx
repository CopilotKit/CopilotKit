"use client";

import React from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { ShowcaseCopilotKit } from "@/components/showcase-copilotkit";
import { useAgenticChatSuggestions } from "./suggestions";

export default function AgenticChatDemo() {
  return (
    // @region[provider-setup]
    <ShowcaseCopilotKit agentId="agentic_chat">
      <Chat />
    </ShowcaseCopilotKit>
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
