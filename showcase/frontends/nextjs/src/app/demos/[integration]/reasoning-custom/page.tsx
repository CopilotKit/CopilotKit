"use client";

// Reasoning (custom render)
//
// Pairs with `reasoning-default`, so you can compare the default and a custom
// reasoning render side by side. This page overrides the `reasoningMessage`
// slot of the `messageView` slot with `ReasoningBlock`, a tagged banner that
// keeps the agent's thinking visible.
//
// Reasoning is its own message type: `CopilotChatMessageView` renders every
// message with `role: "reasoning"` through the `reasoningMessage` slot, whose
// default is `CopilotChatReasoningMessage`. Overriding that slot is the
// supported way to change how reasoning looks.

import type { CopilotChatReasoningMessage } from "@copilotkit/react-core/v2";
import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { makeSlotOverride } from "../_shared/slot-override";
import { ReasoningBlock } from "./reasoning-block";
import { useReasoningCustomSuggestions } from "./suggestions";

// @region[reasoning-block-render]
const AGENT_ID = "reasoning-custom";

export default function ReasoningCustomDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("reasoning-custom")}
      agent={AGENT_ID}
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
  useReasoningCustomSuggestions();
  return (
    <CopilotChat
      agentId={AGENT_ID}
      className="h-full rounded-2xl"
      messageView={{
        reasoningMessage:
          makeSlotOverride<typeof CopilotChatReasoningMessage>(ReasoningBlock),
      }}
    />
  );
}
// @endregion[reasoning-block-render]
