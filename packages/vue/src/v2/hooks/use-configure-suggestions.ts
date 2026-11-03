import { computed, watch } from "vue";
import type { WatchSource } from "vue";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { ɵbindSuggestionsConfig } from "@copilotkit/core";
import type { ɵSuggestionsConfigInput } from "@copilotkit/core";

/**
 * Registers a suggestions configuration (dynamic or static) for the current
 * chat context.
 *
 * Configuration is kept in sync reactively and removed on scope cleanup. Pass
 * `deps` to reload suggestions when values the config reads change.
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
  config: ɵSuggestionsConfigInput | null | undefined,
  deps?: WatchSource<unknown>[],
): void {
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const chatAgentId = computed(
    () => chatConfig.value?.agentId ?? DEFAULT_AGENT_ID,
  );
  const extraDeps = deps ?? [];

  watch(
    () => copilotkit.value,
    (core, _old, onCleanup) => {
      const binding = ɵbindSuggestionsConfig(core, config, {
        chatAgentId: chatAgentId.value,
      });
      // Deep, so a `reactive()` config that changes in place is applied. The
      // binding compares configs by content, so other re-runs are no-ops.
      const stopConfig = watch(
        [() => config, chatAgentId],
        ([nextConfig, nextChatAgentId]) => {
          binding.update(nextConfig, { chatAgentId: nextChatAgentId });
        },
        { deep: true },
      );
      const stopDeps =
        extraDeps.length > 0
          ? watch(extraDeps, () => binding.reload())
          : undefined;
      onCleanup(() => {
        stopConfig();
        stopDeps?.();
        binding.dispose();
      });
    },
    { immediate: true },
  );
}
