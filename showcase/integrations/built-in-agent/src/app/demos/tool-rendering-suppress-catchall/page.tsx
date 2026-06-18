"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { useSuppressCatchAllToolRendering } from "./use-suppress-catch-all-tool-rendering";

export default function ToolRenderingSuppressCatchallDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useSuppressCatchAllToolRendering();

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Find flights",
        message: "Find flights from SFO to JFK.",
      },
      {
        title: "Roll a d20",
        message: "Roll a 20-sided die.",
      },
    ],
    available: "always",
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">
        Tool Rendering — Suppress Catch-all
      </h1>
      <p className="text-sm opacity-70 mb-6">
        Try one of the suggestions. Tool calls still run, but the catch-all
        renderer returns null so otherwise-unhandled tool calls do not paint UI.
      </p>
      <CopilotChat />
    </main>
  );
}
