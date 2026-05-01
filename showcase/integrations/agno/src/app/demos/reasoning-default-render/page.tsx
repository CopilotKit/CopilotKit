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
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function ReasoningDefaultRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning-default-render">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <Chat />
          {/* @endregion[default-reasoning-zero-config] */}
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // @canonical-suggestion-pill
  // Single canonical e2e pill — title + message come straight from
  // showcase/aimock/_canonical-catalog.json. The wording matches a fixture
  // in showcase/aimock/d5-all.json so the local stack renders
  // deterministically without a real LLM call.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Default reasoning",
        message: "talk me through your default reasoning on a tricky riddle",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="reasoning-default-render"
      className="h-full rounded-2xl"
    />
  );
}
