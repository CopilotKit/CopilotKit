"use client";

// Reasoning (Default Render) demo.
//
// Backend emits AG-UI REASONING_MESSAGE_* events (see backend/agent.py). This
// page passes NO custom `reasoningMessage` slot, so CopilotKit's built-in
// `CopilotChatReasoningMessage` renders the reasoning as a collapsible card
// with "Thinking…" → "Thought for Xs" and a streaming cursor — no custom
// component needed.

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning-default-render">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <CopilotChat
            agentId="reasoning-default-render"
            className="h-full rounded-2xl"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
