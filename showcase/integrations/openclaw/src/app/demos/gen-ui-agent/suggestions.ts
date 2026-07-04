"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weeknight pasta",
        message: "Generate a quick weeknight pasta recipe.",
      },
      {
        title: "Vegan breakfast",
        message: "Generate a hearty vegan breakfast recipe.",
      },
      {
        title: "Chocolate dessert",
        message: "Generate a simple chocolate dessert recipe.",
      },
    ],
    available: "always",
  });
}
