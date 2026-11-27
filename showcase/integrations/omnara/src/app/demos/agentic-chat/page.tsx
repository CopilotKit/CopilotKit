"use client";

import React from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { DemoSessionProvider } from "@/lib/demo-session-provider";
import { useAgenticChatSuggestions } from "./suggestions";

export default function AgenticChatDemo() {
  return (
    // @region[provider-setup]
    <DemoSessionProvider agent="agentic_chat">
      <Chat />
    </DemoSessionProvider>
    // @endregion[provider-setup]
  );
}

// @region[chat-component]
function Chat() {
  useAgenticChatSuggestions();
  // @region[render-chat]
  return (
    <div className="h-full px-6">
      <CopilotChat agentId="agentic_chat" />
    </div>
  );
  // @endregion[render-chat]
}
// @endregion[chat-component]
