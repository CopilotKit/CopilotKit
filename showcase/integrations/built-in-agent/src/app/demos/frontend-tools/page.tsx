"use client";

// Frontend Tools demo.
//
// Showcases `useFrontendTool` — a tool DEFINED in the React tree,
// EXECUTED in the browser, and INVOKED by the agent. The tool's schema
// is forwarded over the AG-UI protocol so the agent knows it exists; the
// tool's handler runs locally in the page on invocation. No backend
// tool wiring required.

// @region[frontend-tool]
// @region[frontend-tool-registration]
import React, { useState } from "react";
import {
  CopilotKitProvider,
  CopilotChat,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function FrontendToolsDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Chat />
    </CopilotKitProvider>
  );
}

function Chat() {
  const [background, setBackground] = useState<string>(
    "var(--copilot-kit-background-color)",
  );

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

  useConfigureSuggestions({
    suggestions: [
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
        <CopilotChat className="h-full rounded-2xl" />
      </div>
    </div>
  );
}
