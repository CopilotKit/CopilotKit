"use client";

// @region[frontend-tool-registration]
import React, { useState } from "react";
import { CopilotSidebar, useFrontendTool } from "@copilotkit/react-core/v2";
import { DemoSessionProvider } from "@/lib/demo-session-provider";
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
    handler: async ({ background: nextBackground }) => {
      setBackground(nextBackground);
      return { status: "success" };
    },
    // @endregion[frontend-tool-handler]
  });
  // @endregion[frontend-tool-registration]

  useFrontendToolsSuggestions();

  return (
    <Background background={background}>
      <CopilotSidebar agentId="frontend_tools" defaultOpen />
    </Background>
  );
}

export default function FrontendToolsDemo() {
  return (
    <DemoSessionProvider agent="frontend_tools">
      <Chat />
    </DemoSessionProvider>
  );
}
