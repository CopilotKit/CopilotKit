import {
  useFrontendTool,
  useRenderTool,
  useRenderToolCall,
  useDefaultRenderTool,
  useComponent,
  useHumanInTheLoop,
  useInterrupt,
} from "@copilotkit/react-core/v2";
// useDefaultTool and useLazyToolRenderer are v1 APIs (registered in HOOK_REGISTRY
// with importSource "@copilotkit/react-core"). They wrap `useCopilotAction` and
// don't live in the v2 package.
import { useDefaultTool, useLazyToolRenderer } from "@copilotkit/react-core";

export function Tools() {
  // V2 render: frontend-callable tool that searches the web. Handler
  // returns realistic mock results so the model has something to
  // summarise — otherwise it loops calling the same tool repeatedly.
  // @ts-expect-error – test-workspace only
  useFrontendTool({
    name: "search_web",
    description: "Search the web for a given query",
    parameters: [{ name: "q", type: "string" }],
    handler: async ({ q }: { q?: string } = {}) =>
      JSON.stringify({
        query: q ?? "",
        results: [
          {
            title: `Top result for "${q ?? ""}"`,
            snippet:
              "Mock weather snippet: Berlin is currently 18°C, partly cloudy, light breeze from the west.",
            url: "https://example.test/weather/berlin",
          },
          {
            title: "Wikipedia — Climate of Berlin",
            snippet:
              "Mock encyclopedic summary stub returned by the playground test fixture.",
            url: "https://example.test/wiki/berlin-climate",
          },
        ],
      }),
  });

  // V2 render: render component shown while / after a tool result arrives
  // @ts-expect-error – test-workspace only
  useRenderTool({
    name: "search_results",
    render: () => <div>Search results</div>,
  });

  // V2 render: render component shown for an in-flight tool call
  // @ts-expect-error – test-workspace only
  useRenderToolCall({
    name: "search_call",
    render: () => <div>Searching…</div>,
  });

  // V2 render: fallback renderer for any tool that has no specific renderer
  // @ts-expect-error – test-workspace only
  useDefaultRenderTool({
    name: "fallback_render",
    render: () => <div>Tool output</div>,
  });

  // V2 render: lazily-loaded renderer (code-split via dynamic import)
  // @ts-expect-error – test-workspace only
  useLazyToolRenderer({
    name: "lazy_render",
    render: () => <div>Lazy tool output</div>,
  });

  // V2 render: mount a full React component as a tool renderer
  // @ts-expect-error – test-workspace only
  useComponent({
    name: "Chart",
    render: () => <div>Chart component</div>,
  });

  // V2 render: catch-all default tool handler
  // @ts-expect-error – test-workspace only
  useDefaultTool({
    name: "default_tool",
    handler: async () => {},
  });

  // V2 render: human-in-the-loop approval gate before a release
  // @ts-expect-error – test-workspace only
  useHumanInTheLoop({
    name: "approve_release",
    description: "Ask a human to approve before releasing to production",
    parameters: [],
    render: () => <div>Approve release?</div>,
  });

  // V2 render: generic interrupt hook (no name field)
  // @ts-expect-error – test-workspace only
  useInterrupt({
    render: () => <div>Interrupted — awaiting user input</div>,
  });

  return <div>v2 tools</div>;
}
