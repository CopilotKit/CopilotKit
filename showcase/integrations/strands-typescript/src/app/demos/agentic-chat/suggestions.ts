"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// @region[configure-suggestions]
export function useAgenticChatSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      {
        title: "Tell me a joke",
        message: "Tell me a one-line joke.",
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
