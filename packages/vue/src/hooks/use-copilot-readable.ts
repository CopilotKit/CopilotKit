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
