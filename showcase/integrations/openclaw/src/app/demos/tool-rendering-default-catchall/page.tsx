"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant (OpenClaw).
//
// This is the simplest point in the tool-rendering progression. The OpenClaw
// agent exposes generic server tools (shell exec, file read, etc.) that stream
// over AG-UI as TOOL_CALL_START/ARGS/RESULT/END. Rather than register a branded
// per-tool renderer (see the sibling `tool-rendering` cell for the CUSTOM
// catch-all), this cell opts into CopilotKit's BUILT-IN default tool-call card.
//
// `useDefaultRenderTool()` (called with no config) registers the package-
// provided `DefaultToolCallRenderer` under the `*` wildcard. That renderer
// shows the tool name, a live status pill (Running → Done), and a collapsible
// Arguments / Result section that fills in as the call progresses — all with
// zero custom UI. Without this hook the runtime has NO `*` renderer, so tool
// calls are invisible and the user only sees the assistant's final summary.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { useSuggestions } from "./suggestions";

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
  // Opt in to CopilotKit's built-in default tool-call card. Called with no
  // config so the package-provided `DefaultToolCallRenderer` is used as the
  // wildcard renderer — this is the "out-of-the-box" UI the cell showcases.
  useDefaultRenderTool();
  // @endregion[default-catchall-zero-config]

  useSuggestions();

  return (
    <CopilotChat
      agentId="tool-rendering-default-catchall"
      className="h-full rounded-2xl"
    />
  );
}
