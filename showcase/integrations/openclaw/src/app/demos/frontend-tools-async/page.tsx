"use client";

// Frontend Tools (Async) demo (OpenClaw).
//
// Same `useFrontendTool` story as the frontend-tools demo — a tool DEFINED in
// the React tree, EXECUTED in the browser, and INVOKED by the OpenClaw agent —
// but the handler is ASYNC. The tool schema is forwarded over AG-UI in
// RunAgentInput.tools; the clawg-ui adapter hands it to OpenClaw as a
// caller-provided `clientTool`, so the model can call it. When it does, the run
// stops with a pending tool call, clawg-ui emits TOOL_CALL_* events, and this
// page's async handler awaits a simulated client-side round-trip before
// applying the new background — exercising the full async frontend-tool path.

// @region[frontend-tool-async-registration]
import React, { useState } from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { Background, DEFAULT_BACKGROUND } from "./background";
import { useFrontendToolsAsyncSuggestions } from "./suggestions";

// Simulates a client-side async round-trip (persisting a theme preference,
// reading from IndexedDB, etc.) so the async-handler path is exercised
// end-to-end.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Chat() {
  const [background, setBackground] = useState<string>(DEFAULT_BACKGROUND);

  useFrontendTool({
    name: "change_background_async",
    description:
      "Change the page background. Accepts any valid CSS background value — colors, linear or radial gradients, etc.",
    parameters: z.object({
      background: z
        .string()
        .describe("The CSS background value. Prefer gradients."),
    }),
    // @region[frontend-tool-async-handler]
    // Async handler: awaits a simulated client-side round-trip (500ms) before
    // applying the new background and returning a result.
    handler: async ({ background }) => {
      await sleep(500);
      setBackground(background);
      return {
        status: "success",
        message: `Background changed to ${background}`,
      };
    },
    // @endregion[frontend-tool-async-handler]
  });
  // @endregion[frontend-tool-async-registration]

  useFrontendToolsAsyncSuggestions();

  return (
    <Background background={background}>
      <CopilotSidebar agentId="frontend-tools-async" defaultOpen />
    </Background>
  );
}

export default function FrontendToolsAsyncDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="frontend-tools-async">
      <Chat />
    </CopilotKit>
  );
}
