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
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
    // @endregion[provider-setup]
  );
}

// @region[chat-component]
function Chat() {
  useAgenticChatReasoningSuggestions();
  // @region[render-chat]
  return (
    <CopilotChat agentId="agentic-chat-reasoning" className="h-full rounded-2xl" />
  );
  // @endregion[render-chat]
}
// @endregion[chat-component]
