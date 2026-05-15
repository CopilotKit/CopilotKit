"use client";

// Agentic Chat (Reasoning) — demonstrates visible display of the agent's
// reasoning / thinking chain.
//
// How reasoning surfaces in v2 (verified by reading source):
//   - packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx
//     discriminates messages by `message.role === "reasoning"` and renders
//     them via the `reasoningMessage` slot (default component:
//     `CopilotChatReasoningMessage`). Reasoning is therefore a first-class
//     message type — no custom-renderer plumbing required for the happy path.
//   - The native `CopilotChatReasoningMessage` already shows a "Thinking…" /
//     "Thought for X" header with an expandable content region.
//
// Backend uses a reasoning-capable OpenAI model (gpt-5) via PydanticAI's
// Responses-API model. PydanticAI's AG-UI bridge surfaces the reasoning
// summaries from the Responses API as REASONING / THINKING events on the
// AG-UI stream, which the v2 chat renders through the slot above.

// @region[reasoning-block-render]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
} from "@copilotkit/react-core/v2";
import { ReasoningBlock } from "./reasoning-block";

export default function AgenticChatReasoningDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic-chat-reasoning">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  return (
    <CopilotChat
      agentId="agentic-chat-reasoning"
      className="h-full rounded-2xl"
      messageView={{
        reasoningMessage: ReasoningBlock as typeof CopilotChatReasoningMessage,
      }}
    />
  );
}
// @endregion[reasoning-block-render]
