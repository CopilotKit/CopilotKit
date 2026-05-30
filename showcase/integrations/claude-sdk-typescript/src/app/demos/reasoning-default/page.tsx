"use client";

// Reasoning — Default
//
// Pairs with `reasoning-custom` (the Custom variant) so users can
// compare default vs custom reasoning rendering side by side. This cell
// renders <CopilotChat> with NO slot override — reasoning messages are
// rendered by the built-in `CopilotChatReasoningMessage` component
// (Thinking… / Thought for X header with an expandable content region).
//
// Both demos share the dedicated Claude extended-thinking runtime
// (`/api/copilotkit-reasoning` → agent_server's `/reasoning` endpoint)
// so `thinking_delta` events flow as AG-UI REASONING_MESSAGE_*. The only
// difference between the two demos is whether the
// `messageView.reasoningMessage` slot is overridden.

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { useReasoningDefaultSuggestions } from "./suggestions";

// @region[default-reasoning-zero-config]
const AGENT_ID = "reasoning-default";

export default function ReasoningDefaultDemo() {
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
  useReasoningDefaultSuggestions();
  return <CopilotChat agentId={AGENT_ID} className="h-full rounded-2xl" />;
}
// @endregion[default-reasoning-zero-config]
