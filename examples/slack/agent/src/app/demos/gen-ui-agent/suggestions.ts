"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Plan a product launch",
        message: "Plan a product launch for a new mobile app.",
      },
      {
        title: "Organize a team offsite",
        message: "Organize a three-day engineering team offsite.",
      },
      {
        title: "Research a competitor",
        message:
          "Research our top competitor and summarize their strengths and weaknesses.",
      },
    ],
    available: "always",
  });
}
