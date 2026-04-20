import { computed, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import type { Suggestion } from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

export interface UseSuggestionsOptions {
  agentId?: MaybeRefOrGetter<string | undefined>;
}

export interface UseSuggestionsResult {
  suggestions: Ref<Suggestion[]>;
  isLoading: Ref<boolean>;
  reloadSuggestions: () => void;
  clearSuggestions: () => void;
}

/**
 * Provides reactive access to agent suggestions.
 *
 * It tracks suggestion updates for the resolved agent and exposes helpers to
 * reload or clear suggestions.
 *
 * @example
 * ```ts
 * const { suggestions, isLoading, reloadSuggestions } = useSuggestions({
 *   agentId: "default",
 * });
 * ```
 */
export function useSuggestions(
  options: UseSuggestionsOptions = {},
): UseSuggestionsResult {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const resolvedAgentId = computed(
    () => toValue(options.agentId) ?? config.value?.agentId ?? DEFAULT_AGENT_ID,
  );

  const suggestions = ref<Suggestion[]>([]);
  const isLoading = ref(false);

  const initState = () => {
    const result = copilotkit.value.getSuggestions(resolvedAgentId.value);
    suggestions.value = result.suggestions;
    isLoading.value = result.isLoading;
  };

  watch([() => copilotkit.value, resolvedAgentId], () => initState(), {
    immediate: true,
  });

  watch(
    [() => copilotkit.value, resolvedAgentId],
    (_newValues, _old, onCleanup) => {
      const core = copilotkit.value;
      const agentId = resolvedAgentId.value;
      const sub = core.subscribe({
        onSuggestionsChanged: ({ agentId: changedAgentId, suggestions: s }) => {
          if (changedAgentId !== agentId) return;
          suggestions.value = s;
          const result = core.getSuggestions(agentId);
          isLoading.value = result.isLoading;
        },
        onSuggestionsStartedLoading: ({ agentId: changedAgentId }) => {
          if (changedAgentId !== agentId) return;
          isLoading.value = true;
        },
        onSuggestionsFinishedLoading: ({ agentId: changedAgentId }) => {
          if (changedAgentId !== agentId) return;
          isLoading.value = false;
        },
        onSuggestionsConfigChanged: () => {
          const result = core.getSuggestions(agentId);
          suggestions.value = result.suggestions;
          isLoading.value = result.isLoading;
        },
      });
      onCleanup(() => sub.unsubscribe());
    },
    { immediate: true },
  );

  const reloadSuggestions = () => {
    copilotkit.value.reloadSuggestions(resolvedAgentId.value);
  };
  const clearSuggestions = () => {
    copilotkit.value.clearSuggestions(resolvedAgentId.value);
  };

  return {
    suggestions,
    isLoading,
    reloadSuggestions,
    clearSuggestions,
  };
}
