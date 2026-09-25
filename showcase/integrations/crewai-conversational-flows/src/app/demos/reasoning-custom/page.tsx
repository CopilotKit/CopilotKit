"use client";

// Reasoning — Custom
//
// Pairs with `reasoning-default` so users can compare default vs custom
// reasoning rendering side by side. Both demos share the same backend
// (`reasoning_agent` graph) and runtime URL (/api/copilotkit). This cell
// overrides the `reasoningMessage` slot on the `messageView` slot with
// `ReasoningBlock` — a tagged amber banner that emphasizes the agent's
// thinking chain.
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
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
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
