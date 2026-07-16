import { getContext } from "svelte";
import type { Suggestion } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";

export interface CreateSuggestionsOptions {
  agentId?: string;
}

export interface CreateSuggestionsResult {
  suggestions: Suggestion[];
  isLoading: boolean;
  reloadSuggestions: () => void;
  clearSuggestions: () => void;
}

export function createSuggestions(
  options: CreateSuggestionsOptions = {},
): CreateSuggestionsResult {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("createSuggestions must be used within CopilotKitProvider");
  }

  let resolvedAgentId = $derived(options.agentId ?? DEFAULT_AGENT_ID);

  let suggestions = $state<Suggestion[]>([]);
  let isLoading = $state(false);

  $effect(() => {
    const core = context.copilotkit;
    const result = core.getSuggestions(resolvedAgentId);
    suggestions = result.suggestions;
    isLoading = result.isLoading;

    const sub = core.subscribe({
      onSuggestionsChanged: ({ agentId: changedAgentId, suggestions: s }) => {
        if (changedAgentId !== resolvedAgentId) return;
        suggestions = s;
        const r = core.getSuggestions(resolvedAgentId);
        isLoading = r.isLoading;
      },
      onSuggestionsStartedLoading: ({ agentId: changedAgentId }) => {
        if (changedAgentId !== resolvedAgentId) return;
        isLoading = true;
      },
      onSuggestionsFinishedLoading: ({ agentId: changedAgentId }) => {
        if (changedAgentId !== resolvedAgentId) return;
        isLoading = false;
      },
      onSuggestionsConfigChanged: () => {
        const r = core.getSuggestions(resolvedAgentId);
        suggestions = r.suggestions;
        isLoading = r.isLoading;
      },
    });

    return () => sub.unsubscribe();
  });

  const reloadSuggestions = () => {
    context.copilotkit.reloadSuggestions(resolvedAgentId);
  };

  const clearSuggestions = () => {
    context.copilotkit.clearSuggestions(resolvedAgentId);
  };

  return {
    get suggestions() {
      return suggestions;
    },
    get isLoading() {
      return isLoading;
    },
    reloadSuggestions,
    clearSuggestions,
  };
}
