"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { useSuggestions } from "../tool-rendering/suggestions";
import { useSuppressWeatherToolRendering } from "./use-suppress-weather-tool-rendering";

const AGENT_ID = "tool-rendering-named-override";

export default function ToolRenderingNamedOverrideDemo() {
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
  useDefaultRenderTool();
  useSuppressWeatherToolRendering();
  useSuggestions();

  return <CopilotChat agentId={AGENT_ID} className="h-full rounded-2xl" />;
}
