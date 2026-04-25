"use client";

// Reasoning (Default Render) demo.
//
// Backend emits AG-UI REASONING_MESSAGE_* events via the Agno AGUI interface
// (see `.venv/lib/site-packages/agno/os/interfaces/agui/utils.py` — Agno emits
// ReasoningMessageStartEvent / ContentEvent / EndEvent through AGUI).
//
// This page passes NO custom `reasoningMessage` slot, so CopilotKit's built-in
// `CopilotChatReasoningMessage` renders the reasoning as a collapsible card.
// Zero configuration — reasoning just shows up.

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
