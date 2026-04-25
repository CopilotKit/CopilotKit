"use client";

// Tool Rendering — CUSTOM CATCH-ALL variant.
//
// A single branded wildcard renderer is registered via
// `useDefaultRenderTool`, painting every Langroid backend tool call
// (get_weather, search_flights, generate_a2ui, ...) with the same card.

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
  // @region[use-default-render-tool-wildcard]
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
  // @endregion[use-default-render-tool-wildcard]

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
        message: "What's the weather in Tokyo?",
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
