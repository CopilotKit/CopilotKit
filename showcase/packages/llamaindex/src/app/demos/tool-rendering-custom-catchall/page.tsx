"use client";

/**
 * Tool Rendering — CUSTOM CATCH-ALL variant.
 *
 * Opts out of the default tool-call UI by registering a single custom
 * wildcard renderer via `useDefaultRenderTool`. The same branded card
 * paints every tool call.
 */

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
  useDefaultRenderTool(
    {
      render: ({ name, parameters, status, result }: any) => (
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
