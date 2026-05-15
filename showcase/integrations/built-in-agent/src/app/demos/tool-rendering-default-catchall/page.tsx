"use client";

// Tool Rendering — DEFAULT CATCH-ALL variant.
//
// The simplest entry point in the tool-rendering progression. The
// backend exposes a handful of mock tools (get_weather, search_flights,
// get_stock_price, roll_dice) and the frontend opts into CopilotKit's
// built-in default tool-call card by calling `useDefaultRenderTool()`
// with no config — every tool call falls through to the package-shipped
// `DefaultToolCallRenderer`.

import {
  CopilotKitProvider,
  CopilotChat,
  useConfigureSuggestions,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

export default function ToolRenderingDefaultCatchallDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  // @region[default-catchall-zero-config]
  // Opt in to CopilotKit's built-in default tool-call card. Called with
  // no config so the package-provided `DefaultToolCallRenderer` is used
  // as the wildcard renderer — this is the "out-of-the-box" UI the cell
  // is meant to showcase.
  useDefaultRenderTool();
  // @endregion[default-catchall-zero-config]

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
        Tool Rendering — Default Catch-all
      </h1>
      <p className="text-sm opacity-70 mb-6">
        Try one of the suggestions. Every tool call renders with
        CopilotKit&rsquo;s built-in default card via{" "}
        <code className="mx-1 px-1 bg-gray-100 rounded">
          useDefaultRenderTool()
        </code>{" "}
        — no per-tool renderers, no custom UI.
      </p>
      <CopilotChat />
    </main>
  );
}
