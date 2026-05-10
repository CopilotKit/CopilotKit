"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useChatSlotsSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
      { title: "Tell me a joke", message: "Tell me a short joke." },
      {
        title: "Show reasoning",
        message:
          "Think out loud step by step about whether 17 is prime, then answer.",
      },
    ],
    available: "always",
  });
}
