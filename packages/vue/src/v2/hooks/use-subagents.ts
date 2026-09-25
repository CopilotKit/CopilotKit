import { computed, shallowReadonly, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type { Subagent } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";

export interface UseSubagentsOptions {
  /** The agent to read. Defaults to the chat's agent. */
  agentId?: MaybeRefOrGetter<string | undefined>;
  /** The thread to read. Defaults to the chat's thread. */
  threadId?: MaybeRefOrGetter<string | undefined>;
}

/**
 * Read the AG-UI subagent invocations on an agent thread, live.
 *
 * Each entry has the subagent's `name`, its `status` (`running`, `done`,
 * `suspended` or `error`), and the tool call or parent subagent that started
 * it. The list is in start order and keeps its reference until it changes.
 *
 * The agent must attribute its output to subagents (AG-UI 1.0 subagent
 * events). An agent that does not gives an empty list.
 *
 * @param options - Optional `agentId` and `threadId` (plain values, refs or
 * getters); both default to the surrounding chat configuration.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useSubagents } from "@copilotkit/vue/v2";
 *
 * const subagents = useSubagents();
 * </script>
 *
 * <template>
 *   <ul>
 *     <li v-for="subagent in subagents" :key="subagent.subagentRunId">
 *       {{ subagent.name }}: {{ subagent.status }}
 *     </li>
 *   </ul>
 * </template>
 * ```
 */
export function useSubagents({ agentId, threadId }: UseSubagentsOptions = {}) {
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const resolvedAgentId = computed(
    () => toValue(agentId) ?? chatConfig.value?.agentId ?? DEFAULT_AGENT_ID,
  );
  // ponytail: outside a chat, the agent's threadId is read when the other
  // inputs change; a threadId change on the agent alone is not watched.
  const resolvedThreadId = computed(
    () =>
      toValue(threadId) ??
      chatConfig.value?.threadId ??
      copilotkit.value.getAgent(resolvedAgentId.value)?.threadId ??
      "",
  );
  const subagents = shallowRef<readonly Subagent[]>([]);

  watch(
    [() => copilotkit.value, resolvedAgentId, resolvedThreadId],
    ([core, watchedAgentId, watchedThreadId], _previous, onCleanup) => {
      subagents.value = core.getSubagents(watchedAgentId, watchedThreadId);
      const subscription = core.subscribe({
        onSubagentsChanged: (event) => {
          const isThisThread =
            event.agentId === watchedAgentId &&
            event.threadId === watchedThreadId;
          if (isThisThread) subagents.value = event.subagents;
        },
      });
      onCleanup(() => subscription.unsubscribe());
    },
    { immediate: true },
  );

  return shallowReadonly(subagents);
}
