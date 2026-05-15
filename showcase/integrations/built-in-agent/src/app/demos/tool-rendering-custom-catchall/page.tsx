"use client";

// Tool Rendering — CUSTOM CATCH-ALL variant.
//
// Same backend tools as `tool-rendering-default-catchall`, but this cell
// opts out of CopilotKit's built-in default tool-call UI by registering
// a SINGLE custom wildcard renderer via `useDefaultRenderTool`. The same
// branded card now paints every tool call — no per-tool renderers yet.

import {
  CopilotKitProvider,
  CopilotChat,
  useDefaultRenderTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import {
  CustomCatchallRenderer,
  type CatchallToolStatus,
} from "./custom-catchall-renderer";

export default function ToolRenderingCustomCatchallDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  // @region[use-default-render-tool-wildcard]
  // `useDefaultRenderTool` is a convenience wrapper around
  // `useRenderTool({ name: "*", ... })` — a single wildcard renderer
  // that handles every tool call not claimed by a named renderer.
  useDefaultRenderTool(
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: ({ name, parameters, status, result }: any) => (
        <CustomCatchallRenderer
          name={name}
          parameters={parameters}
          status={status as CatchallToolStatus}
          result={result}
        />
      ),
    },
    [],
  );
  // @endregion[use-default-render-tool-wildcard]

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
        Tool Rendering — Custom Catch-all
      </h1>
      <p className="text-sm opacity-70 mb-6">
        Try one of the suggestions. A single branded card renders every tool
        call via a wildcard renderer.
      </p>
      <CopilotChat />
    </main>
  );
}
