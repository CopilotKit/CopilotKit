"use client";

// @region[frontend-tool]
// @region[frontend-tool-registration]
import { useState } from "react";
import {
  CopilotKitProvider,
  CopilotChat,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function AgenticChat() {
  return (
    // @region[provider-setup]
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
    // @endregion[provider-setup]
  );
}

function Demo() {
  const [bg, setBg] = useState<string>("var(--copilot-kit-background-color)");

  useFrontendTool({
    name: "setBackground",
    description:
      "Set the page background. Accepts any CSS background value (color, gradient, etc.).",
    parameters: z.object({
      background: z
        .string()
        .describe("CSS background value (color, gradient, etc.)"),
    }),
    // @region[frontend-tool-handler]
    handler: async ({ background }) => {
      setBg(background);
      return { ok: true, background };
    },
    // @endregion[frontend-tool-handler]
  });
  // @endregion[frontend-tool-registration]
  // @endregion[frontend-tool]

  return (
    <main style={{ background: bg, minHeight: "100vh" }} className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Agentic Chat</h1>
      <p className="text-sm opacity-70 mb-6">
        Try: &ldquo;Set the background to a sunset gradient.&rdquo;
      </p>
      <CopilotChat />
    </main>
  );
}
