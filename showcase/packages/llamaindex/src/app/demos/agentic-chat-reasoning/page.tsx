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
// This demo overrides the `reasoningMessage` slot on the `messageView` slot
// to emphasize the reasoning block visually (tagged amber banner, italic,
// labeled "Agent reasoning"). That is the "per-message conditional rendering
// via slots" path — the public, stable way to customize reasoning output.

import React from "react";
import {
  CopilotChat,
  CopilotChatReasoningMessage,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { ReasoningBlock } from "./reasoning-block";

// Outer layer — provider + layout chrome.
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

// Inner — wires a custom `reasoningMessage` slot that makes the thinking
// chain visually prominent, then renders the chat.
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
