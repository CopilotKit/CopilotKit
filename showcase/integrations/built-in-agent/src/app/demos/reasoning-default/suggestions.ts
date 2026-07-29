"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Suggestions registered via the v2 chat composer hook. The prompt is a
// concrete reasoning-eliciting question — gpt-5-mini (and other OpenAI
// reasoning models) only emit `response.reasoning_summary_text.delta`
// events when there's a real problem to think about. Meta-prompts like
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
