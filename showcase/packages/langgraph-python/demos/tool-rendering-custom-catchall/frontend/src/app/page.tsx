"use client";

// Tool Rendering — CUSTOM CATCH-ALL variant (middle of the progression).
//
// Same backend tools as `tool-rendering-default-catchall`, but this
// cell opts out of CopilotKit's built-in default tool-call UI by
// registering a SINGLE custom wildcard renderer via
// `useDefaultRenderTool`. The same branded card now paints every tool
// call — no per-tool renderers yet.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useDefaultRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import {
  CustomCatchallRenderer,
  type CatchallToolStatus,
} from "./custom-catchall-renderer";

export default function ToolRenderingCustomCatchallDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool-rendering-custom-catchall"
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
  // `useDefaultRenderTool` is a convenience wrapper around
  // `useRenderTool({ name: "*", ... })` — a single wildcard renderer
  // that handles every tool call not claimed by a named renderer.
  useDefaultRenderTool(
    {
      render: ({ name, parameters, status, result }) => (
        <CustomCatchallRenderer
          name={name}
          parameters={parameters}
          status={status as CatchallToolStatus}
          result={result}
        />
      ),
    },
    [],
  );

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
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="tool-rendering-custom-catchall"
      className="h-full rounded-2xl"
    />
  );
}
