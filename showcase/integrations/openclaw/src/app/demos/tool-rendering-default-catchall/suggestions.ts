"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSuggestions() {
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
      {
        title: "Chain tools",
        message:
          "Chain a few tools in this single turn: get the weather in Tokyo, search flights from SFO to Tokyo, and roll a d20.",
      },
    ],
    available: "always",
  });
}
