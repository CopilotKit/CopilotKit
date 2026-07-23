"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Suggestions registered via the v2 chat composer hook. Mirrors the
// `reasoning-default` cell so users can compare default vs custom
// reasoning rendering with the same prompt.
//
// IMPORTANT: gpt-5-mini (and OpenAI reasoning models generally) only
// emit `response.reasoning_summary_text.delta` events when there's a
// concrete problem to reason ABOUT. A meta-prompt like "show your
// reasoning step by step" produces no reasoning summary — the model
// recognizes it as a request to reveal chain-of-thought (which it
// refuses) and returns a plain text reply with zero reasoning summary
// content. The reasoning slot then never lights up. A concrete question
// that genuinely requires multi-step thinking reliably triggers it.
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
