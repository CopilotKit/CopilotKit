import { AgentStateMessage } from "@copilotkit/runtime-client-gql";
import { RenderMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { CoagentInChatRenderFunction, useCopilotContext } from "@copilotkit/react-core";

export function RenderAgentStateMessage(props: RenderMessageProps) {
  const { message, inProgress, index, isCurrentMessage } = props;
  const { chatComponentsCache } = useCopilotContext();
  const { icons } = useChatContext();

  if (message instanceof AgentStateMessage) {
    let render: string | CoagentInChatRenderFunction | undefined;

    if (chatComponentsCache.current !== null) {
      render =
        chatComponentsCache.current.coagentActions[`${message.agentName}-${message.nodeName}`] ||
        chatComponentsCache.current.coagentActions[`${message.agentName}-global`];
    }

    if (render) {
      // render a static string
      if (typeof render === "string") {
        // when render is static, we show it only when in progress
        if (isCurrentMessage && inProgress) {
          return (
            <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
              {icons.spinnerIcon} <span className="inProgressLabel">{render}</span>
            </div>
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

        if (typeof toRender === "string") {
          return (
            <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
              {isCurrentMessage && inProgress && icons.spinnerIcon} {toRender}
            </div>
          );
        } else {
          return (
            <div key={index} className="copilotKitCustomAssistantMessage">
              {toRender}
            </div>
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
        <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
          {icons.spinnerIcon}
        </div>
      );
    }
  }
}
