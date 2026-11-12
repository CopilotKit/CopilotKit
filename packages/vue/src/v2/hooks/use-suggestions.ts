import { computed, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import {
  ɵresolveAgentId,
  ɵsubscribeToAgentSuggestions,
} from "@copilotkit/core";
import type {
  CopilotKitCoreGetSuggestionsResult,
  Suggestion,
} from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";

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
  const resolvedAgentId = computed(() =>
    ɵresolveAgentId({
      agentId: toValue(options.agentId),
      chatAgentId: config.value?.agentId,
    }),
  );

  const suggestions = ref<Suggestion[]>([]);
  const isLoading = ref(false);
  const apply = (result: CopilotKitCoreGetSuggestionsResult) => {
    suggestions.value = result.suggestions;
    isLoading.value = result.isLoading;
  };

  watch(
    [() => copilotkit.value, resolvedAgentId],
    ([core, agentId], _old, onCleanup) => {
      apply(core.getSuggestions(agentId));
      onCleanup(ɵsubscribeToAgentSuggestions(core, agentId, apply));
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
