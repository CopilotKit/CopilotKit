"use client";

import { useParams } from "next/navigation";
import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { useAgenticChatSuggestions } from "./suggestions";

export default function AgenticChatDemo() {
  const { integration } = useParams<{ integration: string }>();
  return (
    // @region[provider-setup]
    <CopilotKit
      runtimeUrl={`/api/${integration}/agentic-chat`}
      agent="agentic-chat"
    >
      <Chat />
    </CopilotKit>
    // @endregion[provider-setup]
  );
}

// @region[chat-component]
function Chat() {
  useAgenticChatSuggestions();
  // @region[render-chat]
  return <CopilotChat agentId="agentic-chat" />;
  // @endregion[render-chat]
}
// @endregion[chat-component]
