"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { createMirrorActivityRenderer } from "@/a2ui/MirrorRenderer";
import { sandboxBus } from "@/lib/sandbox-bus";

const ACTIVITY_RENDERERS = [createMirrorActivityRenderer("declarative")];

/* Iframes call `Websandbox.connection.remote.pinCard({...})`; the handler
   bridges into the host via sandbox-bus so /open can subscribe. */
const SANDBOX_FUNCTIONS = [
  {
    name: "pinCard",
    description:
      "Pin a small card to the host app's workspace panel. Use when the user asks to save, remember, or move a piece of generated content out of the chat.",
    parameters: z.object({
      title: z.string().describe("Short title for the card."),
      body: z.string().optional().describe("One-sentence summary."),
      tone: z.enum(["info", "positive", "warning"]).optional(),
    }),
    handler: async (args: {
      title: string;
      body?: string;
      tone?: "info" | "positive" | "warning";
    }) => {
      sandboxBus.publish({ type: "pin_card", payload: args });
      return `Pinned "${args.title}" to the workspace.`;
    },
  },
];

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      renderActivityMessages={ACTIVITY_RENDERERS}
      openGenerativeUI={{ sandboxFunctions: SANDBOX_FUNCTIONS }}
    >
      {children}
    </CopilotKitProvider>
  );
}
