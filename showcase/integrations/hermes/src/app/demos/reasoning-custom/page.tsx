"use client";

// Reasoning — Custom (Hermes)
//
// Pairs with `reasoning-default` so users can compare default vs custom
// reasoning rendering side by side. Both demos share the reasoning backend
// (a second Hermes AG-UI adapter on :8001 running a reasoning-capable model
// — gpt-5-mini — so aimock streams reasoning; the main :8000 backend runs
// gpt-4o, which aimock treats as non-reasoning) via the dedicated
// `/api/copilotkit-reasoning` runtime URL. This cell overrides the
// `reasoningMessage` slot on the `messageView` slot with `ReasoningBlock` —
// a tagged amber banner that emphasizes the agent's thinking chain.
//
// Reasoning is a first-class message type in v2: see
// packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx,
// which discriminates messages by `message.role === "reasoning"` and
// renders them via the `reasoningMessage` slot (default component:
// `CopilotChatReasoningMessage`). The slot override below is the public,
// stable way to customize that output.

import type { CopilotChatReasoningMessage } from "@copilotkit/react-core/v2";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { ReasoningBlock } from "./reasoning-block";
import { useReasoningCustomSuggestions } from "./suggestions";

// @region[reasoning-block-render]
const AGENT_ID = "reasoning-custom";

export default function ReasoningCustomDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-reasoning" agent={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useReasoningCustomSuggestions();
  return (
    <CopilotChat
      agentId={AGENT_ID}
      className="h-full rounded-2xl"
      messageView={{
        reasoningMessage:
          ReasoningBlock as unknown as typeof CopilotChatReasoningMessage,
      }}
    />
  );
}
// @endregion[reasoning-block-render]
