"use client";

/**
 * Static suggestion configuration for the headless-complete demo. The
 * `useConfigureSuggestions` call publishes these to CopilotKit's
 * suggestion store — `useSuggestions` (consumed by `SuggestionBar`) reads
 * them back so they actually appear above the composer.
 */

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useHeadlessSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Weather", message: "What's the weather in Tokyo?" },
      { title: "Stock price", message: "What's the price of AAPL right now?" },
      {
        title: "Highlight a note",
        message: "Highlight this note for me: 'ship the demo on Friday'.",
      },
      {
        title: "Revenue chart",
        message: "Show me a chart of revenue over the last six months.",
      },
    ],
    available: "always",
  });
}
