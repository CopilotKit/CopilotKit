import type { StaticSuggestionsConfig } from "@copilotkit/react-core/v2";

/** Offers an opening prompt without running the domain graph as a suggestion agent. */
export const initialSuggestions: StaticSuggestionsConfig = {
  consumerAgentId: "travel",
  available: "before-first-message",
  suggestions: [{ title: "Plan a trip", message: "Help me plan a new trip." }],
};
