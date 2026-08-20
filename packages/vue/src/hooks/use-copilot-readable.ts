/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/vue — useCopilotReadable:
 *   V2 import and usage:
 *     import { useAgentContext } from "@copilotkit/vue/v2";
 *     useAgentContext({});
 *   V2 replacement source: packages/vue/src/v2/hooks/use-agent-context.ts
 *   V2 docs: https://docs.copilotkit.ai/reference/vue/hooks/useAgentContext
 *
 * @copilotkit/vue — UseCopilotReadableOptions:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/vue/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/vue/src/hooks/use-copilot-readable.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * V1 compatibility wrapper for useCopilotReadable.
 *
 * Provides app-state and other information to the Copilot context.
 * Delegates directly to the v2 CopilotKitCoreVue instance.
 */
import { watch, ref, type Ref } from "vue";
import type { WatchSource } from "vue";
import { useCopilotKit } from "../v2/providers/useCopilotKit";

export interface UseCopilotReadableOptions {
  /** The description of the information to be added to the Copilot context. */
  description: string;
  /** The value to be added to the Copilot context. Object values are automatically stringified. */
  value: unknown;
  /** Whether the context is available to the Copilot. */
  available?: "enabled" | "disabled";
  /** Custom conversion function to serialize the value to a string. */
  convert?: (description: string, value: unknown) => string;
}

export function useCopilotReadable(
  options: UseCopilotReadableOptions,
  deps?: WatchSource<unknown>[],
): Ref<string | undefined> {
  const { copilotkit } = useCopilotKit();
  const ctxIdRef = ref<string | undefined>(undefined);

  const extraDeps = deps ?? [];

  watch(
    [
      () => options.description,
      () => options.value,
      () => options.convert,
      () => options.available,
      ...extraDeps,
    ],
    (_newValues, _old, onCleanup) => {
      const core = copilotkit.value;
      if (!core) return;

      const { description, value, convert, available } = options;

      let serializedValue: string;
      try {
        serializedValue = convert
          ? convert(description, value)
          : JSON.stringify(value);
      } catch (err) {
        console.warn(
          `[CopilotKit] useCopilotReadable: failed to serialize ` +
            `value for "${description}":`,
          err,
        );
        serializedValue = String(value);
      }

      if (available === "disabled") return;

      ctxIdRef.value = core.addContext({
        description,
        value: serializedValue,
      });

      onCleanup(() => {
        if (!ctxIdRef.value) return;
        core.removeContext(ctxIdRef.value);
      });
    },
    { immediate: true },
  );

  return ctxIdRef;
}
