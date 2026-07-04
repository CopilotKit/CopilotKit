"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Suggestions registered via the v2 chat composer hook. Reuses the reasoning
// prompts from the sibling `agentic-chat-reasoning` cell so the OpenClaw agent
// emits REASONING_* events — but here they render through the custom
// `ReasoningBlock` slot instead of the default reasoning panel.
//
// IMPORTANT: reasoning models only emit reasoning content when there's a
// concrete problem to reason ABOUT. A meta-prompt like "show your reasoning
// step by step" produces no reasoning summary. A concrete question that
// genuinely requires multi-step thinking reliably triggers it.
export function useReasoningCustomSuggestions() {
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
