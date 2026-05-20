"use client";

// Reasoning (Default Render) demo — Spring AI port.
//
// Demonstrates the ZERO-config reasoning render path: when a backend emits
// REASONING_MESSAGE_* AG-UI events, CopilotKit's built-in
// `CopilotChatReasoningMessage` renders the reasoning chain automatically
// as a collapsible card. No `reasoningMessage` slot is passed — the demo
// shows the happy-path default.
//
// NOTE: the `ag-ui:spring-ai` adapter does not currently forward OpenAI
// reasoning content as REASONING_MESSAGE_* events — assistants behave like
// a normal chat. When the adapter adds reasoning forwarding (or a
// reasoning-aware Spring AI model is wired through), this page will light
// up automatically.

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
