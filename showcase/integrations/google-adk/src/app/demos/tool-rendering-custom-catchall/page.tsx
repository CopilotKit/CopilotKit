"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useDefaultRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { CustomCatchallRenderer } from "./custom-catchall-renderer";

export default function ToolRenderingCustomCatchallDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="tool_rendering_custom_catchall"
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
  // The render prop is typed by useDefaultRenderTool's `DefaultRenderProps`
  // — destructure without casting and let inference flow through. The
  // runtime emits `"inProgress" | "executing" | "complete"`; both
  // pre-completion states render identically, so collapse them to
  // "executing" before handing off to the renderer.
  // @region[use-default-render-tool-wildcard]
  useDefaultRenderTool(
    {
      render: ({ name, parameters, status, result }) => (
        <CustomCatchallRenderer
          name={name}
          args={(parameters ?? {}) as Record<string, unknown>}
          status={status === "complete" ? "complete" : "executing"}
          result={result}
        />
      ),
    },
    [],
  );
  // @endregion[use-default-render-tool-wildcard]

  // Canonical e2e suggestion — exact catalog match for tool-rendering-custom-catchall.
  // See showcase/aimock/_canonical-catalog.json (frozen).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Custom catchall",
        message: "exercise the custom catchall renderer with an unknown tool",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="tool_rendering_custom_catchall"
      className="h-full rounded-2xl"
    />
  );
}
