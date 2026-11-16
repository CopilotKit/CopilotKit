"use client";

// Tool Rendering: DEFAULT CATCH-ALL variant (simplest).
//
// This cell is the simplest point in the three-way progression. The
// backend exposes a handful of mock tools (get_weather, search_flights,
// get_stock_price, roll_d20) and the frontend ONLY opts into
// CopilotKit's built-in default tool-call card. There are no per-tool
// renderers and no custom wildcard UI.
//
// `useDefaultRenderTool()` (called with no config) registers the built-
// in `DefaultToolCallRenderer` under the `*` wildcard. That renderer
// shows each call's tool name, its status, and its arguments and result
// as the call progresses. The chat groups calls made in a row into one
// card that opens to a row per call. Without this hook the runtime has
// NO `*` renderer, so `useRenderToolCall` falls through to `null` and tool
// calls are invisible: the user only sees the assistant's final text
// summary.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { useSuggestions } from "./suggestions";

export default function ToolRenderingDefaultCatchallDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("tool-rendering-default-catchall")}
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
  // as the wildcard renderer. This is the "out-of-the-box" UI the cell
  // is meant to showcase.
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
