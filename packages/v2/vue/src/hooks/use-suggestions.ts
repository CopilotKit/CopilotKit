import {
  computed,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import type { Suggestion } from "@copilotkitnext/core";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";

export interface UseSuggestionsOptions {
  agentId?: MaybeRefOrGetter<string | undefined>;
}

export interface UseSuggestionsResult {
  suggestions: Ref<Suggestion[]>;
  isLoading: Ref<boolean>;
  reloadSuggestions: () => void;
  clearSuggestions: () => void;
}

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
