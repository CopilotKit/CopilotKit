import { useCopilotKit } from "@copilotkit/react-core";
import type { ReactToolCallRenderer } from "@copilotkit/react-core";

export function useExtraRenderer(renderer: ReactToolCallRenderer<unknown>) {
  const { copilotkit } = useCopilotKit();
  // TODO(copilotkit-2.0): `renderToolCalls` is a read-only array in 2.0. Pass a new list to `copilotkit.setRenderToolCalls([...])` instead of changing it in place: https://docs.copilotkit.ai/migrate/chat-2.0#renderer-lists
  copilotkit.renderToolCalls.push(renderer);
  // TODO(copilotkit-2.0): `renderActivityMessages` is a read-only array in 2.0. Pass a new list to `copilotkit.setRenderActivityMessages([...])` instead of changing it in place: https://docs.copilotkit.ai/migrate/chat-2.0#renderer-lists
  copilotkit.renderActivityMessages.splice(0, 1);
  // Reading the list is fine.
  return copilotkit.renderToolCalls.map((entry) => entry.name);
}
