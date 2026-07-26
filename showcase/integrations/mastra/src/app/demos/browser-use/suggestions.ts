"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show me the top Hacker News stories",
        message: "Show me the top Hacker News stories right now.",
      },
      {
        title: "Summarize the CopilotKit homepage",
        message:
          "Read https://www.copilotkit.ai and summarize what it's about.",
      },
    ],
    available: "always",
  });
}
