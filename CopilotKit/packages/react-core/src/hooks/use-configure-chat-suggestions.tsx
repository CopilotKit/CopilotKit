import { useConfigureSuggestions } from "@copilotkitnext/react";
import { StaticSuggestionsConfig, Suggestion } from "@copilotkitnext/core";

type StaticSuggestionInput = Omit<Suggestion, "isLoading"> & Partial<Pick<Suggestion, "isLoading">>;

type StaticSuggestionsConfigInput = Omit<StaticSuggestionsConfig, "suggestions"> & {
  suggestions: StaticSuggestionInput[];
};

type DynamicSuggestionsConfigInput = {
  /**
   * A prompt or instructions for the GPT to generate suggestions.
   */
  instructions: string;
  /**
   * The minimum number of suggestions to generate. Defaults to `1`.
   * @default 1
   */
  minSuggestions?: number;
  /**
   * The maximum number of suggestions to generate. Defaults to `3`.
   * @default 1
   */
  maxSuggestions?: number;

  /**
   * Whether the suggestions are available. Defaults to `enabled`.
   * @default enabled
   */
  available?: "enabled" | "disabled" | "always" | "before-first-message" | "after-first-message";

  /**
   * An optional class name to apply to the suggestions.
   */
  className?: string;
};

export type UseCopilotChatSuggestionsConfiguration =
  | DynamicSuggestionsConfigInput
  | StaticSuggestionsConfigInput;

export function useConfigureChatSuggestions(
  config: UseCopilotChatSuggestionsConfiguration,
  dependencies: any[] = [],
) {
  useConfigureSuggestions(
    {
      ...config,
      available: config.available === "enabled" ? "always" : config.available,
    },
    { deps: dependencies },
  );
}
