"use client";

// Frontend Tools demo (OpenClaw).
//
// Shows `useFrontendTool` — a tool DEFINED in the React tree, EXECUTED in the
// browser, and INVOKED by the OpenClaw agent. The tool schema is forwarded over
// AG-UI in RunAgentInput.tools; the clawg-ui adapter hands it to OpenClaw as a
// caller-provided `clientTool`, so the model can call it. When it does, the run
// stops with a pending tool call, clawg-ui emits TOOL_CALL_* events, and this
// page's handler runs locally to change the background.

// @region[frontend-tool-registration]
import React, { useState } from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { Background, DEFAULT_BACKGROUND } from "./background";
import { useFrontendToolsSuggestions } from "./suggestions";

function Chat() {
  const [background, setBackground] = useState<string>(DEFAULT_BACKGROUND);

  useFrontendTool({
    name: "change_background",
    description:
      "Change the page background. Accepts any valid CSS background value — colors, linear or radial gradients, etc.",
    parameters: z.object({
      background: z
        .string()
        .describe("The CSS background value. Prefer gradients."),
    }),
    // @region[frontend-tool-handler]
    handler: async ({ background }) => {
      setBackground(background);
      return {
        status: "success",
        message: `Background changed to ${background}`,
      };
    },
    // @endregion[frontend-tool-handler]
  });
  // @endregion[frontend-tool-registration]

  useFrontendToolsSuggestions();

  return (
    <Background background={background}>
      <CopilotSidebar agentId="frontend-tools" defaultOpen />
    </Background>
  );
}

export default function FrontendToolsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="frontend-tools">
      <Chat />
    </CopilotKit>
  );
}
