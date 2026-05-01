"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant.
// The frontend opts into CopilotKit's built-in default tool-call card via
// useDefaultRenderTool() (no config). No per-tool renderers, no custom wildcard.

import React from "react";
import {
  CopilotChat,
  CopilotKit,
  useConfigureSuggestions,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

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
  // @region[default-catchall-zero-config]
  // Opt in to CopilotKit's built-in default tool-call card. Called with
  // no config so the package-provided `DefaultToolCallRenderer` is used
  // as the wildcard renderer — this is the "out-of-the-box" UI the cell
  // is meant to showcase.
  useDefaultRenderTool();
  // @endregion[default-catchall-zero-config]

  // @canonical-suggestion-pill
  // Single canonical e2e pill — title + message come straight from
  // showcase/aimock/_canonical-catalog.json. The wording matches a fixture
  // in showcase/aimock/d5-all.json so the local stack renders
  // deterministically without a real LLM call.
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
        title: "Roll a d20",
        message: "Roll a 20-sided die.",
      },
      {
        title: "Default catchall",
        message: "trigger the default catchall renderer for an unmapped tool",
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
