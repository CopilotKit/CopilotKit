"use client";

// Reasoning (default render)
//
// Pairs with `reasoning-custom`, so you can compare the default and a custom
// reasoning render side by side. This page renders <CopilotChat> with no slot
// override: the built-in `CopilotChatReasoningMessage` renders each reasoning
// message as a collapsible block ("Thinking..." while it streams, "Thought
// for X" when it ends).
//
// Both demos send the same prompt to a reasoning agent. The only difference
// is whether the `messageView.reasoningMessage` slot is overridden.

import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { useReasoningDefaultSuggestions } from "./suggestions";

// @region[default-reasoning-zero-config]
const AGENT_ID = "reasoning-default";

export default function ReasoningDefaultDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("reasoning-default")}
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
  useReasoningDefaultSuggestions();
  return <CopilotChat agentId={AGENT_ID} className="h-full rounded-2xl" />;
}
// @endregion[default-reasoning-zero-config]
