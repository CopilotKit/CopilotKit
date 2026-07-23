"use client";

// Reasoning — Default (Hermes)
//
// Pairs with `reasoning-custom` (the Custom variant) so users can
// compare default vs custom reasoning rendering side by side. This cell
// renders <CopilotChat> with NO slot override — reasoning messages are
// rendered by the built-in `CopilotChatReasoningMessage` component
// (Thinking… / Thought for X header with an expandable content region).
//
// Both reasoning demos share the reasoning backend (a second Hermes AG-UI
// adapter on :8001 running a reasoning-capable model — gpt-5-mini — so
// aimock streams reasoning; the main :8000 backend runs gpt-4o, which
// aimock treats as non-reasoning). They talk to it via the dedicated
// `/api/copilotkit-reasoning` runtime URL. The only difference between the
// two cells is whether the `messageView.reasoningMessage` slot is overridden.

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
