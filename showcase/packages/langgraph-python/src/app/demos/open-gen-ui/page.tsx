"use client";

/**
 * Open-Ended Generative UI — minimal setup.
 * -----------------------------------------
 * The simplest possible example. Enabling `openGenerativeUI` in the
 * runtime (see `src/app/api/copilotkit-ogui/route.ts`) is all that's
 * needed — the runtime middleware streams agent-authored HTML + CSS to
 * the built-in `OpenGenerativeUIActivityRenderer`, which mounts it
 * inside a sandboxed iframe. No custom sandbox functions, no custom
 * tools — just chat.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

const minimalSuggestions = [
  {
    title: "Greeting card",
    message: "Build me a simple greeting card that says hello.",
  },
  {
    title: "Pomodoro timer",
    message:
      "Build a Pomodoro timer UI with a circular progress ring and start / pause / reset buttons. " +
      "Drive the countdown with jsExpressions / setInterval inside the sandbox.",
  },
  {
    title: "Quarterly revenue chart",
    message:
      "Using Chart.js loaded from a CDN, render a bar chart of synthetic quarterly revenue " +
      "(Q1 through Q4) inside the sandbox.",
  },
];

export default function OpenGenUiDemo() {
  // @region[minimal-provider-setup]
  // Minimal Open Generative UI frontend: the built-in activity renderer is
  // registered by CopilotKitProvider, so a plain <CopilotChat /> is enough —
  // no custom tool renderers, no activity-renderer registration.
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-ogui" agent="open-gen-ui">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl flex flex-col p-3">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
  // @endregion[minimal-provider-setup]
}

function Chat() {
  useConfigureSuggestions({
    suggestions: minimalSuggestions,
    available: "always",
  });

  return <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />;
}
