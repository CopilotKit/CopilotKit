import { getContext } from "svelte";
import { COPILOT_KIT_KEY } from "./context";
import type { CopilotKitContextValue } from "./context";

export function useCopilotKit(): CopilotKitContextValue {
  const context = getContext<CopilotKitContextValue>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("useCopilotKit must be used within CopilotKitProvider");
  }
  return context;
}
