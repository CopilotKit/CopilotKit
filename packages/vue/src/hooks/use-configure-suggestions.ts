import { computed, ref, watch } from "vue";
import type { WatchSource } from "vue";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type {
  DynamicSuggestionsConfig,
  Suggestion,
  StaticSuggestionsConfig,
  SuggestionsConfig,
} from "@copilotkit/core";

type StaticSuggestionInput = Omit<Suggestion, "isLoading"> &
  Partial<Pick<Suggestion, "isLoading">>;

type StaticSuggestionsConfigInput = Omit<
  StaticSuggestionsConfig,
  "suggestions"
> & {
  suggestions: StaticSuggestionInput[];
};

type SuggestionsConfigInput =
  | DynamicSuggestionsConfig
  | StaticSuggestionsConfigInput;

function isDynamicConfig(
  config: SuggestionsConfigInput,
): config is DynamicSuggestionsConfig {
  return "instructions" in config;
}

function normalizeStaticSuggestions(
  suggestions: StaticSuggestionInput[],
): Suggestion[] {
  return suggestions.map((s) => ({
    ...s,
    isLoading: s.isLoading ?? false,
  }));
}

/**
 * Registers a suggestions configuration (dynamic or static) for the current
 * chat context.
 *
 * Configuration is kept in sync reactively and removed on scope cleanup.
 *
 * @example
 * ```ts
 * useConfigureSuggestions({
 *   instructions: "Suggest concise next steps for the user",
 *   available: "always",
 * });
 * ```
 */
export function useConfigureSuggestions(
  config: SuggestionsConfigInput | null | undefined,
  deps?: WatchSource<unknown>[],
): void {
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const extraDeps = deps ?? [];

  const resolvedConsumerAgentId = computed(
    () => chatConfig.value?.agentId ?? DEFAULT_AGENT_ID,
  );
  const rawConsumerAgentId = computed(() =>
    config ? (config as SuggestionsConfigInput).consumerAgentId : undefined,
  );

  const normalizedConfig = computed<SuggestionsConfig | null>(() => {
    if (
      !config ||
      (config as { available?: string }).available === "disabled"
    ) {
      return null;
    }
    if (isDynamicConfig(config)) {
      return { ...config };
    }
    const normalizedSuggestions = normalizeStaticSuggestions(
      config.suggestions,
    );
    return { ...config, suggestions: normalizedSuggestions };
  });
  const serializedConfig = computed(() =>
    normalizedConfig.value ? JSON.stringify(normalizedConfig.value) : null,
  );

  const targetAgentId = computed(() => {
    if (!normalizedConfig.value) return resolvedConsumerAgentId.value;
    const consumer = (
      normalizedConfig.value as
        | StaticSuggestionsConfig
        | DynamicSuggestionsConfig
    ).consumerAgentId;
    if (!consumer || consumer === "*") return resolvedConsumerAgentId.value;
    return consumer;
  });

  const isGlobalConfig = computed(
    () =>
      rawConsumerAgentId.value === undefined ||
      rawConsumerAgentId.value === "*",
  );
  const previousSerializedConfig = ref<string | null>(null);

  const requestReload = () => {
    if (!normalizedConfig.value) {
      return;
    }

    if (isGlobalConfig.value) {
      const agents = Object.values(copilotkit.value.agents ?? {});
      for (const entry of agents) {
        const aid = entry.agentId;
        if (!aid) {
          continue;
        }
        if (!entry.isRunning) {
          copilotkit.value.reloadSuggestions(aid);
        }
      }
      return;
    }

    if (targetAgentId.value) {
      copilotkit.value.reloadSuggestions(targetAgentId.value);
    }
  };

  watch(
    [() => copilotkit.value, serializedConfig],
    ([_core, serialized], _old, onCleanup) => {
      if (!serialized || !normalizedConfig.value) {
        return;
      }

      const core = copilotkit.value;
      const cfg = normalizedConfig.value;
      const id = core.addSuggestionsConfig(cfg);
      requestReload();

      onCleanup(() => core.removeSuggestionsConfig(id));
    },
    { immediate: true },
  );

  watch(
    [normalizedConfig, serializedConfig],
    ([cfg, serialized]) => {
      if (!cfg) {
        previousSerializedConfig.value = null;
        return;
      }

      if (serialized && previousSerializedConfig.value === serialized) {
        return;
      }

      if (serialized) {
        previousSerializedConfig.value = serialized;
      }

      requestReload();
    },
    { immediate: false },
  );

  watch(
    [normalizedConfig, () => extraDeps.length, ...extraDeps],
    ([cfg]) => {
      if (!cfg || extraDeps.length === 0) {
        return;
      }
      requestReload();
    },
    { immediate: true },
  );
}
