"use client";

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { useAgenticChatReasoningSuggestions } from "./suggestions";

// The OpenClaw agent runs in reasoning "stream" mode, so REASONING_* events
// arrive alongside the answer and CopilotChat renders them as a reasoning panel.
export default function AgenticChatReasoningDemo() {
  return (
    // @region[provider-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic-chat-reasoning">
      <Chat />
    </CopilotKit>
    // @endregion[provider-setup]
  );
}

// @region[chat-component]
function Chat() {
  useAgenticChatReasoningSuggestions();
  // @region[render-chat]
  return <CopilotChat agentId="agentic-chat-reasoning" />;
  // @endregion[render-chat]
}
// @endregion[chat-component]
