"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant.
//
// The frontend opts into CopilotKit's built-in `DefaultToolCallRenderer`
// as the `*` wildcard. The Langroid backend exposes `get_weather` and
// `search_flights` (and `generate_a2ui`) — all painted by the same
// built-in card on this page.

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
  // Register CopilotKit's built-in DefaultToolCallRenderer as the
  // wildcard renderer for every tool call.
  useDefaultRenderTool();
  // @endregion[default-catchall-zero-config]

  useConfigureSuggestions({
    suggestions: [
      // canonical e2e pill — see showcase/aimock/_canonical-catalog.json
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
