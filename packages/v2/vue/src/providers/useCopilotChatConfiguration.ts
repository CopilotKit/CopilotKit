import { computed, inject, type ComputedRef } from "vue";
import { CopilotChatConfigurationKey } from "./keys";
import type { CopilotChatConfigurationValue } from "./types";

export function useCopilotChatConfiguration(): ComputedRef<CopilotChatConfigurationValue | null> {
  const injected = inject<ComputedRef<CopilotChatConfigurationValue> | undefined>(
    CopilotChatConfigurationKey,
    undefined,
  );
  return computed(() => injected?.value ?? null);
}
