"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant (.NET / Microsoft Agent Framework).
//
// This cell is the simplest point in the three-way progression. The .NET
// SalesAgent backend exposes a handful of tools (get_weather, search_flights,
// get_sales_todos, etc.) and the frontend ONLY opts into CopilotKit's built-in
// default tool-call card — no per-tool renderers, no custom wildcard UI.
//
// `useDefaultRenderTool()` (called with no config) registers the built-in
// `DefaultToolCallRenderer` under the `*` wildcard. That renderer shows the
// tool name, a live status pill (Running → Done), and a collapsible
// "Arguments / Result" section that fills in as the call progresses. Without
// this hook the runtime has NO `*` renderer, so `useRenderToolCall` falls
// through to `null` and tool calls are invisible — the user only sees the
// assistant's final text summary.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
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
        title: "Weather in Tokyo",
        message: "How's the weather in Tokyo today?",
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
