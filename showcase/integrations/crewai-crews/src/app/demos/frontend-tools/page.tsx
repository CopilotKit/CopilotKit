"use client";

import React, { useState } from "react";
import {
  useFrontendTool,
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { z } from "zod";

export default function FrontendToolsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="frontend_tools">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  const [background, setBackground] = useState<string>(
    "var(--copilot-kit-background-color)",
  );

  // @region[frontend-tool]
  // @region[frontend-tool-registration]
  useFrontendTool({
    name: "change_background",
    description:
      "Change the background color of the chat. Accepts any valid CSS background value — colors, linear or radial gradients, etc.",
    parameters: z.object({
      background: z
        .string()
        .describe("The CSS background value. Prefer gradients."),
    }),
    // @region[frontend-tool-handler]
    handler: async ({ background }: { background: string }) => {
      setBackground(background);
      return {
        status: "success",
        message: `Background changed to ${background}`,
      };
    },
    // @endregion[frontend-tool-handler]
  });
  // @endregion[frontend-tool-registration]
  // @endregion[frontend-tool]

  // @canonical: pill exercises catalog message — see showcase/aimock/_canonical-catalog.json
  // First entry matches the aimock fixture in showcase/aimock/d5-all.json
  // so the local stack renders deterministically without a real LLM call.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Switch theme",
        message: "switch theme to dark mode",
      },
      {
        title: "Change background",
        message: "Change the background to a blue-to-purple gradient.",
      },
      {
        title: "Sunset theme",
        message: "Make the background a sunset-themed gradient.",
      },
    ],
    available: "always",
  });

  return (
    <div
      className="flex justify-center items-center h-screen w-full"
      data-testid="background-container"
      style={{ background }}
    >
      <div className="h-full w-full max-w-4xl">
        <CopilotChat agentId="frontend_tools" className="h-full rounded-2xl" />
      </div>
    </div>
  );
}
