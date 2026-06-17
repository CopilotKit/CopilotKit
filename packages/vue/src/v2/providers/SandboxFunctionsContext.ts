import { computed, inject, type ComputedRef, type Ref } from "vue";
import type { SandboxFunction } from "../types";
import { SandboxFunctionsKey } from "./keys";

export function useSandboxFunctions(): ComputedRef<readonly SandboxFunction[]> {
  const functionsRef = inject<Ref<readonly SandboxFunction[]>>(
    SandboxFunctionsKey,
    computed(() => []),
  );
  return computed(() => functionsRef.value);
}
