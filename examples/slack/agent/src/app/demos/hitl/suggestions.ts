"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useHitlSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Simple plan",
        message: "Please plan a trip to mars in 5 steps.",
      },
      {
        title: "Complex plan",
        message: "Please plan a pasta dish in 10 steps.",
      },
    ],
    available: "always",
  });
}
