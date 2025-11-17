import {
  useConfigureSuggestions,
  useCopilotChatConfiguration,
  useCopilotKit,
  useSuggestions,
} from "@copilotkitnext/react";
import { StaticSuggestionsConfig, Suggestion } from "@copilotkitnext/core";
import { useCopilotContext } from "../context";
import { useEffect, useMemo } from "react";

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
): ReturnType<typeof useSuggestions> {
  const { agentSession } = useCopilotContext();
  const { copilotkit } = useCopilotKit();

  const available = config.available === "enabled" ? "always" : config.available;

  const finalSuggestionConfig = {
    ...config,
    available,
    consumerAgentId: agentSession?.agentName, // Use chatConfig.agentId here
  };
  useConfigureSuggestions(finalSuggestionConfig, { deps: dependencies });

  const result = useSuggestions({ agentId: agentSession?.agentName });

  useEffect(() => {
    if (finalSuggestionConfig.available === "disabled") return;
    const subscription = copilotkit.subscribe({
      onAgentsChanged: () => {
        // When agents change, check if our target agent now exists and reload
        const agent = copilotkit.getAgent(agentSession?.agentName!);
        if (agent && !agent.isRunning && !result.suggestions.length) {
          copilotkit.reloadSuggestions(agentSession?.agentName!);
        }
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return result;
}
