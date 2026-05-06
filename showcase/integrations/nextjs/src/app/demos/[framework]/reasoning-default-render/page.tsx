"use client";

// Reasoning (Default Render) demo.
//
// Backend emits AG-UI REASONING_MESSAGE_* events (same as reasoning-agent).
// This page passes NO custom `reasoningMessage` slot, so CopilotKit's built-in
// `CopilotChatReasoningMessage` renders the reasoning as a collapsible card.

import React, { use } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

const DEMO_ID = "reasoning-default-render";

export default function ReasoningDefaultRenderDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    <CopilotKit runtimeUrl={`/api/${framework}/${DEMO_ID}`} agent={DEMO_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          {/* @region[default-reasoning-zero-config] */}
          <CopilotChat
            agentId={DEMO_ID}
            className="h-full rounded-2xl"
          />
          {/* @endregion[default-reasoning-zero-config] */}
        </div>
      </div>
    </CopilotKit>
  );
}
