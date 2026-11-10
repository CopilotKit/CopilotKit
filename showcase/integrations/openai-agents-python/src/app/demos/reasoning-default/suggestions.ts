"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Suggestions registered via the v2 chat composer hook. The prompt is a
// concrete reasoning-eliciting question — reasoning models only emit a
// reasoning summary when there's a real problem to think about. Meta-prompts like
// "show your reasoning" produce no reasoning summary, so the reasoning
// slot would never light up.
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
