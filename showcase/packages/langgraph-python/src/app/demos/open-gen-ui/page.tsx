"use client";

import React from "react";
import { z } from "zod";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

/**
 * Open-Ended Generative UI
 * ------------------------
 * The agent streams ONE `generateSandboxedUi` tool call; the runtime's
 * `OpenGenerativeUIMiddleware` converts that stream into
 * `open-generative-ui` activity events. Passing `openGenerativeUI` to
 * CopilotKit activates the built-in `OpenGenerativeUIActivityRenderer`,
 * which mounts the agent-authored HTML + CSS inside a sandboxed iframe.
 */
export default function OpenGenUiDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-ogui"
      agent="open-gen-ui"
      openGenerativeUI={{
        // Host-side functions the generated UI can invoke from inside the
        // sandbox via `Websandbox.connection.remote.<name>(args)`.
        sandboxFunctions: [
          {
            name: "notifyHost",
            description:
              "Send a short string message from the sandboxed UI back to the host page.",
            parameters: z.object({ message: z.string() }),
            handler: async ({ message }: { message: string }) => {
              // eslint-disable-next-line no-console
              console.log("[open-gen-ui] sandbox -> host:", message);
              return { ok: true };
            },
          },
        ],
      }}
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
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Build a greeting card",
        message: "Build me a simple card that says Hello.",
      },
      {
        title: "Pomodoro timer",
        message: "Create a Pomodoro timer with start, pause, and reset.",
      },
      {
        title: "Quarterly revenue chart",
        message: "Generate a bar chart of quarterly revenue.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex h-full w-full flex-col p-3">
      <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />
    </div>
  );
}
