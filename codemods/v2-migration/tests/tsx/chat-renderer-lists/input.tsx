import { useCopilotKit } from "@copilotkit/react-core/v2";
import type { ReactToolCallRenderer } from "@copilotkit/react-core/v2";

export function useExtraRenderer(renderer: ReactToolCallRenderer<unknown>) {
  const { copilotkit } = useCopilotKit();
  copilotkit.renderToolCalls.push(renderer);
  copilotkit.renderActivityMessages.splice(0, 1);
  // Reading the list is fine.
  return copilotkit.renderToolCalls.map((entry) => entry.name);
}
