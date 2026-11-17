import { inject } from "vue";
import { CopilotKitKey } from "./keys";

export function useCopilotKit() {
  const context = inject(CopilotKitKey);
  if (!context) {
    throw new Error("useCopilotKit must be used within CopilotKitProvider");
  }

  return context;
}
