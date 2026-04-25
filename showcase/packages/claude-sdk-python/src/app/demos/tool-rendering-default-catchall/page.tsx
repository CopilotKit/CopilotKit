"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant (simplest).
//
// The backend exposes a handful of mock tools (get_weather, search_flights,
// etc.) and the frontend ONLY opts into CopilotKit's built-in default
// tool-call card — no per-tool renderers, no custom wildcard UI.
//
// `useDefaultRenderTool()` (called with no config) registers the built-
// in `DefaultToolCallRenderer` under the `*` wildcard.

import React from "react";
import {
  CopilotChat,
  useConfigureSuggestions,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";

export default function ToolRenderingDefaultCatchallDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool-rendering-default-catchall"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Opt in to CopilotKit's built-in default tool-call card. Called with
  // no config so the package-provided `DefaultToolCallRenderer` is used
  // as the wildcard renderer.
  useDefaultRenderTool();

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Find flights",
        message: "Find flights from SFO to JFK.",
      },
      {
        title: "Check financial data",
        message: "Show me the latest financial data.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="tool-rendering-default-catchall"
      className="h-full rounded-2xl"
    />
  );
}
