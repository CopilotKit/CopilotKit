/**
 * V1 compatibility wrapper for `useCopilotReadable`.
 *
 * Vue returns an adapted `Ref` for the context ID. The legacy `parentId` and
 * `categories` fields remain accepted for source compatibility, but are not
 * consumed by the pinned React v1 behavior.
 *
 * @example
 * ```ts
 * const contextId = useCopilotReadable({
 *   description: "The selected customer",
 *   value: selectedCustomer,
 * });
 * ```
 */
import { ref, watch } from "vue";
import type { Ref } from "vue";
import type { WatchSource } from "vue";
import { useCopilotKit } from "../v2/providers/useCopilotKit";

export interface UseCopilotReadableOptions {
  /** The description of the information to be added to the Copilot context. */
  description: string;
  /** The value to be added to the Copilot context. Object values are automatically stringified. */
  value: unknown;
  /** Legacy compatibility field accepted but not consumed by the v1 runtime. */
  parentId?: string;
  /** Legacy compatibility field accepted but not consumed by the v1 runtime. */
  categories?: string[];
  /** Whether the context is available to the Copilot. */
  available?: "enabled" | "disabled";
  /** React v1 public signature; the runtime invokes it with the value only. */
  convert?: (description: string, value: unknown) => string;
}

export function useCopilotReadable(
  options: UseCopilotReadableOptions,
  dependencies?: WatchSource<unknown>[],
): Ref<string | undefined> {
  // React v1 accepts this argument but does not include it in the effect inputs.
  void dependencies;
  const { copilotkit } = useCopilotKit();
  const ctxIdRef = ref<string | undefined>(undefined);

  watch(
    [
      () => copilotkit.value,
      () => options.description,
      () => options.value,
      () => options.convert,
    ],
    (_newValues, _oldValues, onCleanup) => {
      const core = copilotkit.value;
      if (!core) return;

      const { description, value, convert, available } = options;
      const found = Object.entries(core.context).find(([, contextItem]) => {
        return (
          JSON.stringify({ description, value }) === JSON.stringify(contextItem)
        );
      });

      if (found) {
        ctxIdRef.value = found[0];
        if (available === "disabled") core.removeContext(ctxIdRef.value);
        return;
      }

      if (available === "disabled") return;

      ctxIdRef.value = core.addContext({
        description,
        value: convert
          ? (convert as unknown as (value: unknown) => string)(value)
          : JSON.stringify(value),
      });

      onCleanup(() => {
        if (!ctxIdRef.value) return;
        core.removeContext(ctxIdRef.value);
      });
    },
    { immediate: true, flush: "sync" },
  );

  return ctxIdRef;
}
