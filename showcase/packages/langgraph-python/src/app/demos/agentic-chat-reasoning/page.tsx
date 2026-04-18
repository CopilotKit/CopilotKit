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
// (Note: `useRenderCustomMessages` is an internal hook consumed by
// `CopilotChatMessageView`; registration is via the provider's
// `renderCustomMessages` prop, which the v1-compat `CopilotKit` wrapper
// overrides. Slot override is the right tool here.)

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatReasoningMessage,
} from "@copilotkit/react-core/v2";
import type { ReasoningMessage, Message } from "@ag-ui/core";

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

// Custom reasoning renderer — receives the `ReasoningMessage` and
// (optionally) the full message list + running state from the slot system.
// Shows the content inline so the user can always see the agent's thinking
// chain, with a visibly tagged header.
function ReasoningBlock({
  message,
  messages,
  isRunning,
}: {
  message: ReasoningMessage;
  messages?: Message[];
  isRunning?: boolean;
}) {
  const isLatest = messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = !!(isRunning && isLatest);
  const hasContent = !!(message.content && message.content.length > 0);

  return (
    <div
      data-testid="reasoning-block"
      className="my-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2 font-medium text-amber-800">
        <span className="inline-block rounded bg-amber-200 px-2 py-0.5 text-xs uppercase tracking-wider">
          Reasoning
        </span>
        <span>
          {isStreaming ? "Thinking…" : hasContent ? "Agent reasoning" : "…"}
        </span>
      </div>
      {hasContent && (
        <div className="mt-1 whitespace-pre-wrap italic text-amber-900/80">
          {message.content}
        </div>
      )}
    </div>
  );
}
