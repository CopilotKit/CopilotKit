import { useCopilotChatConfiguration, useCopilotKit } from "../providers";
import type {
  ReactCustomMessageRenderer,
  ReactCustomMessageRendererPosition,
  ReactEphemeralMessage,
} from "../types/react-custom-message-renderer";
import type { Message } from "@ag-ui/core";

interface UseRenderCustomMessagesParams {
  message: Message;
  position: ReactCustomMessageRendererPosition;
}

export function getApplicableCustomMessageRenderers(
  renderers: ReadonlyArray<ReactCustomMessageRenderer>,
  agentId: string,
): ReactCustomMessageRenderer[] {
  return renderers
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
}

export function useRenderCustomMessages() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();

  if (!config) {
    return null;
  }

  const { agentId, threadId } = config;

  const customMessageRenderers = getApplicableCustomMessageRenderers(
    copilotkit.renderCustomMessages,
    agentId,
  );

  return function (params: UseRenderCustomMessagesParams) {
    if (!customMessageRenderers.length) {
      return null;
    }
    const { message, position } = params;
    const resolvedRunId =
      copilotkit.getRunIdForMessage(agentId, threadId, message.id) ??
      copilotkit.getRunIdsForThread(agentId, threadId).slice(-1)[0];
    const runId = resolvedRunId ?? `missing-run-id:${message.id}`;
    const agent = copilotkit.getAgent(agentId);
    if (!agent) {
      return null;
    }

    const messagesIdsInRun = resolvedRunId
      ? agent.messages
          .filter(
            (msg) =>
              copilotkit.getRunIdForMessage(agentId, threadId, msg.id) ===
              resolvedRunId,
          )
          .map((msg) => msg.id)
      : [message.id];

    const rawMessageIndex = agent.messages.findIndex(
      (msg) => msg.id === message.id,
    );
    const messageIndex = rawMessageIndex >= 0 ? rawMessageIndex : 0;
    const messageIndexInRun = resolvedRunId
      ? Math.max(messagesIdsInRun.indexOf(message.id), 0)
      : 0;
    const numberOfMessagesInRun = resolvedRunId ? messagesIdsInRun.length : 1;
    const stateSnapshot = resolvedRunId
      ? copilotkit.getStateByRun(agentId, threadId, resolvedRunId)
      : undefined;

    let result = null;
    for (const renderer of customMessageRenderers) {
      if (!renderer.render) {
        continue;
      }
      const Component = renderer.render;
      result = (
        <Component
          key={`${runId}-${message.id}-${position}`}
          message={message}
          position={position}
          runId={runId}
          messageIndex={messageIndex}
          messageIndexInRun={messageIndexInRun}
          numberOfMessagesInRun={numberOfMessagesInRun}
          agentId={agentId}
          stateSnapshot={stateSnapshot}
        />
      );
      if (result) {
        break;
      }
    }
    return result;
  };
}

export function useRenderEphemeralMessages() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();

  if (!config) {
    return null;
  }

  const { agentId, threadId } = config;
  const renderers = getApplicableCustomMessageRenderers(
    copilotkit.renderCustomMessages,
    agentId,
  );
  if (!renderers.some((renderer) => renderer.renderEphemeral)) {
    return null;
  }

  return function (params: {
    message: ReactEphemeralMessage;
    messageIndex: number;
    numberOfMessages: number;
  }) {
    if (!renderers.length) {
      return null;
    }

    for (const renderer of renderers) {
      if (!renderer.renderEphemeral) {
        continue;
      }
      const Component = renderer.renderEphemeral;
      return (
        <Component
          key={`ephemeral-${threadId}-${params.message.id}`}
          message={params.message}
          agentId={agentId}
          threadId={threadId}
          messageIndex={params.messageIndex}
          numberOfMessages={params.numberOfMessages}
        />
      );
    }
    return null;
  };
}
