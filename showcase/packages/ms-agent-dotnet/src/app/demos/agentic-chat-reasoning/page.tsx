"use client";

// Agentic Chat (Reasoning) — MS Agent Framework (.NET) port.
//
// Demonstrates visible display of the agent's reasoning / thinking chain.
//
// Backend: `agent/ReasoningAgent.cs` — a DelegatingAIAgent that prompts the
// model to bracket its chain-of-thought in <reasoning>...</reasoning> tags,
// then streams the bracketed segment as `TextReasoningContent` (which
// AG-UI hosting turns into REASONING_MESSAGE_* events) and the rest as
// ordinary text.
//
// Frontend: overrides the `reasoningMessage` slot on the `messageView` slot
// with a tagged amber `ReasoningBlock` so the thinking chain is visually
// prominent — matching the LangGraph Python reference.
//
// Runtime: talks to `/api/copilotkit-reasoning` which proxies to the .NET
// backend's `/reasoning` AG-UI endpoint.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
} from "@copilotkit/react-core/v2";
import { ReasoningBlock } from "./reasoning-block";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-reasoning"
      agent="agentic-chat-reasoning"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // @region[reasoning-block-render]
  return (
    <CopilotChat
      agentId="agentic-chat-reasoning"
      className="h-full rounded-2xl"
      messageView={{
        reasoningMessage: ReasoningBlock as typeof CopilotChatReasoningMessage,
      }}
    />
  );
  // @endregion[reasoning-block-render]
}
