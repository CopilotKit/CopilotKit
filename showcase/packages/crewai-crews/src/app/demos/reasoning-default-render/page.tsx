"use client";

// Reasoning (Default Render) demo.
// Backend emits REASONING_MESSAGE_* events; CopilotKit's built-in
// `CopilotChatReasoningMessage` renders them as a collapsible card.

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
