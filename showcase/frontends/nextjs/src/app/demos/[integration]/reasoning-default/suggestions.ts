"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// The suggestion asks a concrete question that takes several steps to answer.
// OpenAI reasoning models (gpt-6-luna among them) stream a reasoning summary
// only when there is a real problem to think about. A meta prompt such as
// "show your reasoning" gets no reasoning summary, and then no reasoning
// message appears.
export function useReasoningDefaultSuggestions() {
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
