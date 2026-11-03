import type { Message } from "@ag-ui/core";
import { ɵresolveCustomMessageRenderers } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
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

    const agentId = configValue.agentId || DEFAULT_AGENT_ID;
    const { threadId } = configValue;
    const core = copilotkit.value;

    const customMessageRenderers = ɵresolveCustomMessageRenderers(
      core.renderCustomMessages,
      agentId,
    );

    if (!customMessageRenderers.length) {
      return null;
    }

    const { message, position } = params;
    const resolvedRunId =
      core.getRunIdForMessage(agentId, threadId, message.id) ??
      core.getRunIdsForThread(agentId, threadId).slice(-1)[0];
    const runId = resolvedRunId ?? `missing-run-id:${message.id}`;
    const agent = core.getAgent(agentId);
    if (!agent) {
      return null;
    }

    const messagesIdsInRun = resolvedRunId
      ? agent.messages
          .filter(
            (msg) =>
              core.getRunIdForMessage(agentId, threadId, msg.id) ===
              resolvedRunId,
          )
          .map((msg) => msg.id)
      : [message.id];

    const rawMessageIndex = agent.messages.findIndex(
      (msg) => msg.id === message.id,
    );
    if (rawMessageIndex < 0) {
      console.warn(
        `[CopilotKit] useRenderCustomMessages: message "${message.id}" ` +
          `not found in agent "${agentId}" messages`,
      );
    }
    const messageIndex = Math.max(0, rawMessageIndex);
    const messageIndexInRun = resolvedRunId
      ? Math.max(messagesIdsInRun.indexOf(message.id), 0)
      : 0;
    const numberOfMessagesInRun = resolvedRunId ? messagesIdsInRun.length : 1;
    const stateSnapshot = resolvedRunId
      ? core.getStateByRun(agentId, threadId, resolvedRunId)
      : undefined;

    const props: VueCustomMessageRendererProps = {
      message,
      position,
      runId,
      messageIndex,
      messageIndexInRun,
      numberOfMessagesInRun,
      agentId,
      stateSnapshot,
    };

    // Agent-scoped renderers come first. Use the first one that has a
    // render function.
    const selected = customMessageRenderers.find(
      (candidate) => candidate.render,
    );
    if (!selected) return null;

    return { renderer: selected.render, props };
  };
}
