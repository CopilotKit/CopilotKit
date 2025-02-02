import { RenderMessageProps } from "../props";
import { CoagentInChatRenderFunction, useCopilotContext } from "@copilotkit/react-core";

export function RenderAgentStateMessage(props: RenderMessageProps) {
  const { chatComponentsCache } = useCopilotContext();
  const { message, inProgress, index, isCurrentMessage, AssistantMessage } = props;

  if (message.isAgentStateMessage()) {
    let render: string | CoagentInChatRenderFunction | undefined;

    if (chatComponentsCache.current !== null) {
      render =
        chatComponentsCache.current.coAgentStateRenders[
          `${message.agentName}-${message.nodeName}`
        ] || chatComponentsCache.current.coAgentStateRenders[`${message.agentName}-global`];
    }

    if (render) {
      // render a static string
      if (typeof render === "string") {
        // when render is static, we show it only when in progress
        if (isCurrentMessage && inProgress) {
          return (
            <AssistantMessage
              rawData={message}
              message={render}
              data-message-role="assistant"
              key={index}
              isLoading={true}
              isGenerating={true}
            />
          );
        }
        // Done - silent by default to avoid a series of "done" messages
        else {
          return null;
        }
      }
      // render is a function
      else {
        const state = message.state;

        let status = message.active ? "inProgress" : "complete";

        const toRender = render({
          status: status as any,
          state,
          nodeName: message.nodeName,
        });

        // No result and complete: stay silent
        if (!toRender && status === "complete") {
          return null;
        }

        if (!toRender && isCurrentMessage && inProgress) {
          return (
            <AssistantMessage
              data-message-role="assistant"
              key={index}
              rawData={message}
              isLoading={true}
              isGenerating={true}
            />
          );
        } else if (!toRender) {
          return null;
        }

        if (typeof toRender === "string") {
          return (
            <AssistantMessage
              rawData={message}
              message={toRender}
              isLoading={true}
              isGenerating={true}
              data-message-role="assistant"
              key={index}
            />
          );
        } else {
          return (
            <AssistantMessage
              rawData={message}
              data-message-role="agent-state-render"
              key={index}
              isLoading={false}
              isGenerating={false}
              subComponent={toRender}
            />
          );
        }
      }
    }
    // No render function found- show the default message
    else if (!inProgress || !isCurrentMessage) {
      // Done - silent by default to avoid a series of "done" messages
      return null;
    } else {
      // In progress
      return (
        <AssistantMessage
          rawData={message}
          isLoading={true}
          isGenerating={true}
          data-message-role="assistant"
          key={index}
        />
      );
    }
  }
}
