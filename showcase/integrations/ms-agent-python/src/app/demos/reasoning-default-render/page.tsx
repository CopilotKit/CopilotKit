"use client";

// Reasoning (Default Render) demo.
//
// The backend agent (src/agents/reasoning_agent.py) emits first-class
// AG-UI REASONING_MESSAGE_* events via the Responses API on a
// reasoning-capable model. With NO slot override, CopilotKit renders them
// using its built-in `CopilotChatReasoningMessage` component (Thinking… /
// Thought for X header with an expandable content region). This is the
// zero-config path.

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

const AGENT_ID = "reasoning-default-render";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-reasoning" agent={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <CopilotChat agentId={AGENT_ID} className="h-full rounded-2xl" />
          {/* @endregion[default-reasoning-zero-config] */}
        </div>
      </div>
    </CopilotKit>
  );
}
