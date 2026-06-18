"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useConfigureSuggestions,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { useSuppressWeatherToolRendering } from "./use-suppress-weather-tool-rendering";

export default function ToolRenderingNamedOverrideDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useDefaultRenderTool();
  useSuppressWeatherToolRendering();

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in SF",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Stock price",
        message: "What's the current price of AAPL?",
      },
      {
        title: "Find flights",
        message: "Find flights from SFO to JFK.",
      },
    ],
    available: "always",
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">
        Tool Rendering — Named Override
      </h1>
      <p className="text-sm opacity-70 mb-6">
        Weather calls are suppressed by a named renderer, while other tool calls
        still fall through to the built-in catch-all card.
      </p>
      <CopilotChat />
    </main>
  );
}
