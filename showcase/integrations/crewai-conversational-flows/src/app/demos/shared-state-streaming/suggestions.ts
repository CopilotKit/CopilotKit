"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSharedStateStreamingSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Write a short poem",
        message: "Write a short poem about autumn leaves.",
      },
      {
        title: "Draft an email",
        message:
          "Draft a polite email declining a meeting next Tuesday afternoon.",
      },
      {
        title: "Explain quantum computing",
        message:
          "Write a 2-paragraph explanation of quantum computing for a curious teenager.",
      },
    ],
    available: "always",
  });
}
