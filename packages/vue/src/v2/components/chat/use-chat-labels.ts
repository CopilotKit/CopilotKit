import { computed } from "vue";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";

/**
 * The chat labels in effect: the surrounding chat configuration's, or the
 * default English labels outside a chat.
 * @internal
 */
export function useChatLabels() {
  const config = useCopilotChatConfiguration();
  return computed<Readonly<CopilotChatLabels>>(
    () => config.value?.labels ?? CopilotChatDefaultLabels,
  );
}
