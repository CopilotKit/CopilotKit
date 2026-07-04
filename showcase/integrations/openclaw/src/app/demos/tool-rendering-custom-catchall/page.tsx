"use client";

// Tool Rendering — CUSTOM CATCH-ALL variant (OpenClaw).
//
// The OpenClaw agent exposes generic server tools (shell exec, read, etc.)
// rather than a fixed, known set. Instead of registering a branded per-tool
// renderer for each one, this cell opts out of CopilotKit's built-in default
// tool-call UI by registering a SINGLE custom wildcard renderer via
// `useDefaultRenderTool`. The same app-designed, on-brand card now paints
// EVERY tool call — showing the tool name, its arguments (as JSON), and its
// result. clawg-ui streams TOOL_CALL_START/ARGS/RESULT/END over AG-UI, and
// CopilotChat drives the card through its inProgress → executing → complete
// lifecycle.

// @region[catchall-renderer]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import {
  CustomCatchallRenderer,
  type CatchallToolStatus,
} from "./custom-catchall-renderer";
import { useSuggestions } from "./suggestions";

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
  // `useRenderTool({ name: "*", ... })` — a single wildcard renderer that
  // handles every tool call the agent makes as a branded card.
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
  // @endregion[catchall-renderer]

  useSuggestions();

  return (
    <CopilotChat
      agentId="tool-rendering-custom-catchall"
      className="h-full rounded-2xl"
    />
  );
}
