"use client";

// Reasoning (Default Render) demo.
//
// Backend agent uses PydanticAI's Responses-API model pinned to a
// reasoning-capable OpenAI model (gpt-5) — the AG-UI bridge translates
// the Responses API's reasoning items into REASONING_MESSAGE_* events
// on the AG-UI stream.
//
// This page passes NO custom `reasoningMessage` slot, so CopilotKit's
// built-in `CopilotChatReasoningMessage` renders the reasoning as a
// collapsible card — the zero-config path.

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning-default-render">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <CopilotChat
            agentId="reasoning-default-render"
            className="h-full rounded-2xl"
          />
          {/* @endregion[default-reasoning-zero-config] */}
        </div>
      </div>
    </CopilotKit>
  );
}
