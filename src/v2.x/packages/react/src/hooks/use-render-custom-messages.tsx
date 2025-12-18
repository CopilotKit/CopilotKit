import { useCopilotChatConfiguration, useCopilotKit } from "@/providers";
import { ReactCustomMessageRendererPosition } from "@/types/react-custom-message-renderer";
import { Message } from "@ag-ui/core";

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

  const { agentId, threadId } = config;

  const customMessageRenderers = copilotkit.renderCustomMessages
    .filter((renderer) => renderer.agentId === undefined || renderer.agentId === agentId)
    .sort((a, b) => {
      const aHasAgent = a.agentId !== undefined;
      const bHasAgent = b.agentId !== undefined;
      if (aHasAgent === bHasAgent) return 0;
      return aHasAgent ? -1 : 1;
    });

  return function (params: UseRenderCustomMessagesParams) {
    if (!customMessageRenderers.length) {
      return null;
    }
    const { message, position } = params;
    const runId = copilotkit.getRunIdForMessage(agentId, threadId, message.id)!;
    const agent = copilotkit.getAgent(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const messagesIdsInRun = agent.messages
      .filter((msg) => copilotkit.getRunIdForMessage(agentId, threadId, msg.id) === runId)
      .map((msg) => msg.id);

    const messageIndex = agent.messages.findIndex((msg) => msg.id === message.id) ?? 0;
    const messageIndexInRun = Math.min(messagesIdsInRun.indexOf(message.id), 0);
    const numberOfMessagesInRun = messagesIdsInRun.length;
    const stateSnapshot = copilotkit.getStateByRun(agentId, threadId, runId);

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
