"use client";

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { useSuggestions } from "../tool-rendering-default-catchall/suggestions";
import { useSuppressCatchAllToolRendering } from "./use-suppress-catch-all-tool-rendering";

const AGENT_ID = "tool-rendering-suppress-catchall";

export default function ToolRenderingSuppressCatchallDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useSuppressCatchAllToolRendering();
  useSuggestions();

  return <CopilotChat agentId={AGENT_ID} className="h-full rounded-2xl" />;
}
