"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// The same suggestion as `reasoning-default`, so both demos render the same
// reasoning.
//
// The suggestion asks a concrete question that takes several steps to answer.
// OpenAI reasoning models (gpt-6-luna among them) stream a reasoning summary
// only when there is a real problem to think about. A meta prompt such as
// "show your reasoning step by step" reads as a request for the hidden chain
// of thought, which the model refuses: it answers in plain text with no
// reasoning summary, and then no reasoning message appears.
export function useReasoningCustomSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show reasoning",
        message:
          "Explain step by step why the sky appears blue during the day but red at sunset.",
      },
    ],
    available: "always",
  });
}
