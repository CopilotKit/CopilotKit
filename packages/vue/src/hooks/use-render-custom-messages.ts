import type { Message } from "@ag-ui/core";
import {
  ɵgetCustomMessageRenderProps,
  ɵresolveCustomMessageRenderContext,
} from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import type {
  VueCustomMessageRendererPosition,
  VueCustomMessageRendererProps,
} from "../types";

interface UseRenderCustomMessagesParams {
  message: Message;
  position: VueCustomMessageRendererPosition;
}

/**
 * Returns a function that resolves the appropriate custom message renderer for
 * a given message and position.
 *
 * Matches the React `useRenderCustomMessages` API: filters registered
 * renderers by the current agent, preferring agent-scoped renderers over
 * global ones, and computes the full renderer props (runId, indices, state
 * snapshot).
 *
 * The returned function yields `null` if no chat configuration is available
 * (i.e. when called outside a `CopilotChat` component tree) or if no
 * matching renderer is found.
 */
export function useRenderCustomMessages() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();

  return function renderCustomMessage(params: UseRenderCustomMessagesParams) {
    const configValue = config.value;
    if (!configValue) return null;

    const core = copilotkit.value;
    const { agentId, renderers } = ɵresolveCustomMessageRenderContext(
      core.renderCustomMessages,
      configValue.agentId,
    );
    // Agent-scoped renderers come first. Use the first one that has a
    // render function.
    const selected = renderers.find((candidate) => candidate.render);
    if (!selected) return null;

    const agent = core.getAgent(agentId);
    if (!agent) return null;

    const props: VueCustomMessageRendererProps = ɵgetCustomMessageRenderProps(
      core,
      {
        agentId,
        threadId: configValue.threadId,
        agent,
        message: params.message,
        position: params.position,
      },
    );

    return { renderer: selected.render, props };
  };
}
