"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// @region[configure-suggestions]
export function useAgenticChatReasoningSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show reasoning",
        message:
          "Explain step by step why the sky appears blue during the day but red at sunset.",
      },
      {
        title: "Plan a trip",
        message:
          "Plan a 3-day trip to Tokyo, reasoning through the trade-offs at each step.",
      },
      {
        title: "Is 17 prime?",
        message: "Walk me through whether 17 is prime.",
      },
    ],
    available: "always",
  });
}
// @endregion[configure-suggestions]
