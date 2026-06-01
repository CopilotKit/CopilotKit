import type { Component, VNodeChild } from "vue";
import type { Message } from "@ag-ui/core";
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

interface CustomMessageRendererResult {
  renderer:
    | Component<VueCustomMessageRendererProps>
    | ((props: VueCustomMessageRendererProps) => VNodeChild);
  props: VueCustomMessageRendererProps;
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

  return function renderCustomMessage(
    params: UseRenderCustomMessagesParams,
  ): CustomMessageRendererResult | null {
    const configValue = config.value;
    if (!configValue) return null;

    const agentId = configValue.agentId || DEFAULT_AGENT_ID;
    const { threadId } = configValue;
    const core = copilotkit.value;

    const customMessageRenderers = [...core.renderCustomMessages]
      .filter(
        (renderer) =>
          renderer.agentId === undefined || renderer.agentId === agentId,
      )
      .sort((a, b) => {
        const aHasAgent = a.agentId !== undefined;
        const bHasAgent = b.agentId !== undefined;
        if (aHasAgent === bHasAgent) return 0;
        return aHasAgent ? -1 : 1;
      });

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

    const props: CustomMessageRendererResult["props"] = {
      message,
      position,
      runId,
      messageIndex,
      messageIndexInRun,
      numberOfMessagesInRun,
      agentId,
      stateSnapshot,
    };

    // Iterate renderers like React: try each one and use the first that
    // returns a non-null render function.
    for (const candidate of customMessageRenderers) {
      if (!candidate.render) {
        continue;
      }
      return {
        renderer: candidate.render as CustomMessageRendererResult["renderer"],
        props,
      };
    }

    return null;
  };
}
