import { ActionExecutionMessage, MessageStatusCode } from "@copilotkit/runtime-client-gql";
import { RenderMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { RenderFunctionStatus, useCopilotContext } from "@copilotkit/react-core";

export function RenderActionExecutionMessage(props: RenderMessageProps) {
  const { message, inProgress, index, isCurrentMessage, actionResult } = props;
  const { chatComponentsCache } = useCopilotContext();
  const { icons } = useChatContext();

  if (message instanceof ActionExecutionMessage) {
    if (chatComponentsCache.current !== null && chatComponentsCache.current.actions[message.name]) {
      const render = chatComponentsCache.current.actions[message.name];
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
        const args = message.arguments;

        let status: RenderFunctionStatus = "inProgress";

        if (actionResult !== undefined) {
          status = "complete";
        } else if (message.status.code !== MessageStatusCode.Pending) {
          status = "executing";
        }

        try {
          const toRender = render({
            status: status as any,
            args,
            result: actionResult,
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
        } catch (e) {
          console.error(`Error executing render function for action ${message.name}: ${e}`);
          return (
            <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
              {isCurrentMessage && inProgress && icons.spinnerIcon}
              <b>❌ Error executing render: {message.name}</b>
              <br />
              {e instanceof Error ? e.message : String(e)}
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
