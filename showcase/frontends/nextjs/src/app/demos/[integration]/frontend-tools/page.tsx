"use client";

// @region[frontend-tool-registration]
import React, { useState } from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { Background, DEFAULT_BACKGROUND } from "./background";
import { useFrontendToolsSuggestions } from "./suggestions";

function Chat() {
  const [pageBackground, setPageBackground] = useState(DEFAULT_BACKGROUND);

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
      setPageBackground(background);
      return { status: "success" };
    },
    // @endregion[frontend-tool-handler]
  });
  // @endregion[frontend-tool-registration]

  useFrontendToolsSuggestions();

  return (
    <Background background={pageBackground}>
      <CopilotSidebar agentId="frontend_tools" defaultOpen />
    </Background>
  );
}

export default function FrontendToolsDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("frontend-tools")}
      agent="frontend_tools"
    >
      <Chat />
    </CopilotKit>
  );
}
