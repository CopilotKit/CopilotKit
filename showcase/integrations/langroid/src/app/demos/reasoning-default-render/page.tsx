"use client";

// Reasoning (Default Render) demo.
//
// NOTE: The Langroid adapter in agui_adapter.py does not currently emit
// AG-UI REASONING_MESSAGE_* events — Langroid's ChatAgent does not expose
// a separate reasoning/thinking channel on its response. The backend agent
// just responds normally; this page shows the built-in CopilotChat behavior
// with the zero-config default render path (no custom reasoning slot).

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
