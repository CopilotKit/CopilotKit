import { computed, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useCopilotKit } from "../providers/useCopilotKit";

export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

export interface AgentContextInput {
  description: MaybeRefOrGetter<string>;
  value: MaybeRefOrGetter<JsonSerializable>;
}

/**
 * Registers reactive contextual data that is sent with agent runs.
 *
 * The context entry is added when the composable is active and removed
 * automatically on scope cleanup.
 *
 * @example
 * ```ts
 * useAgentContext({
 *   description: "Current workspace",
 *   value: "copilotkit-vue",
 * });
 * ```
 */
export function useAgentContext(context: AgentContextInput): void {
  const { copilotkit } = useCopilotKit();
  const resolvedDescription = computed(() => toValue(context.description));
  const resolvedValue = computed(() => toValue(context.value));

  const stringValue = computed(() =>
    typeof resolvedValue.value === "string"
      ? resolvedValue.value
      : JSON.stringify(resolvedValue.value),
  );

  watch(
    [() => copilotkit.value, resolvedDescription, stringValue],
    (_newValues, _old, onCleanup) => {
      const core = copilotkit.value;
      const id = core.addContext({
        description: resolvedDescription.value,
        value: stringValue.value,
      });
      onCleanup(() => core.removeContext(id));
    },
    { immediate: true },
  );
}
