import {
  ɵgetCustomMessageRenderProps,
  ɵresolveCustomMessageRenderContext,
} from "@copilotkit/core";
import { useCopilotChatConfiguration, useCopilotKit } from "../providers";
import type { ReactCustomMessageRendererPosition } from "../types/react-custom-message-renderer";
import type { Message } from "@ag-ui/core";

interface UseRenderCustomMessagesParams {
  message: Message;
  position: ReactCustomMessageRendererPosition;
}

export function useRenderCustomMessages() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();

  if (!config) {
    return null;
  }

  const { threadId } = config;
  const { agentId, renderers: customMessageRenderers } =
    ɵresolveCustomMessageRenderContext(
      copilotkit.renderCustomMessages,
      config.agentId,
    );

  // No renderer can ever produce output, so hand the caller nothing rather
  // than a function that always returns null. Callers gate expensive work
  // (per-message state-snapshot cloning, memo wrappers) on this being truthy.
  if (!customMessageRenderers.length) {
    return null;
  }

  return function (params: UseRenderCustomMessagesParams) {
    const { message, position } = params;
    const agent = copilotkit.getAgent(agentId);
    if (!agent) {
      return null;
    }
    const props = ɵgetCustomMessageRenderProps(copilotkit, {
      agentId,
      threadId,
      agent,
      message,
      position,
    });

    // Try each renderer in order and show the first that draws something.
    let result = null;
    for (const renderer of customMessageRenderers) {
      if (!renderer.render) {
        continue;
      }
      const Component = renderer.render;
      result = (
        <Component
          key={`${props.runId}-${message.id}-${position}`}
          {...props}
        />
      );
      if (result) {
        break;
      }
    }
    return result;
  };
}
