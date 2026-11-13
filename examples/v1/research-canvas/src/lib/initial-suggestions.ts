import type { StaticSuggestionsConfig } from "@copilotkit/react-core/v2";

/** Offers an opening prompt without running the domain graph as a suggestion agent. */
export const initialSuggestions: StaticSuggestionsConfig = {
  consumerAgentId: "research_agent",
  available: "before-first-message",
  suggestions: [
    {
      title: "Lifespan of penguins",
      message: "Research the lifespan of penguins.",
    },
  ],
};
