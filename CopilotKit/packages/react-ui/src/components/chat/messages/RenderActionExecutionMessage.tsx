import { MessageStatusCode } from "@copilotkit/runtime-client-gql";
import { RenderMessageProps } from "../props";
import { RenderFunctionStatus, useCopilotContext } from "@copilotkit/react-core";
import { AssistantMessage as DefaultAssistantMessage } from "./AssistantMessage";

export function RenderActionExecutionMessage({
  AssistantMessage = DefaultAssistantMessage,
  ...props
}: RenderMessageProps) {
  const { chatComponentsCache } = useCopilotContext();
  const { message, inProgress, index, isCurrentMessage, actionResult } = props;

  if (message.isActionExecutionMessage()) {
    if (
      chatComponentsCache.current !== null &&
      (chatComponentsCache.current.actions[message.name] ||
        chatComponentsCache.current.actions["*"])
    ) {
      const render =
        chatComponentsCache.current.actions[message.name] ||
        chatComponentsCache.current.actions["*"];
      // render a static string
      if (typeof render === "string") {
        // when render is static, we show it only when in progress
        if (isCurrentMessage && inProgress) {
          return (
            <AssistantMessage
              rawData={message}
              key={index}
              data-message-role="assistant"
              isLoading={false}
              isGenerating={true}
              message={render}
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
        const args = message.arguments;

        let status: RenderFunctionStatus = "inProgress";

        if (actionResult !== undefined) {
          status = "complete";
        } else if (message.status.code !== MessageStatusCode.Pending) {
          status = "executing";
        }

        try {
          const toRender = render({
            status: status as any, // Cast to any as RenderFunctionStatus is a union that can be complex to narrow here
            args,
            result: actionResult,
            name: message.name,
            messageId: message.id, // Pass messageId for HITL action correlation
          } as any);
          // No result and complete: stay silent
          if (!toRender && status === "complete") {
            return null;
          }
          if (typeof toRender === "string") {
            return (
              <AssistantMessage
                rawData={message}
                data-message-role="assistant"
                key={index}
                isLoading={false}
                isGenerating={false}
                message={toRender}
              />
            );
          } else {
            return (
              <AssistantMessage
                rawData={message}
                data-message-role="action-render"
                key={index}
                isLoading={false}
                isGenerating={false}
                subComponent={toRender}
              />
            );
          }
        } catch (e) {
          // It's useful to log this error for developers to debug their custom render functions
          console.error(`Error executing render function for action ${message.name}: ${e}`);
          return (
            <AssistantMessage
              rawData={message}
              data-message-role="assistant"
              key={index}
              isLoading={false}
              isGenerating={false}
              subComponent={
                <div className="copilotKitMessage copilotKitAssistantMessage">
                  <b>❌ Error executing render function for action {message.name}:</b>
                  <pre>{e instanceof Error ? e.message : String(e)}</pre>
                </div>
              }
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
          key={index}
          data-message-role="assistant"
          isLoading={true}
          isGenerating={true}
        />
      );
    }
  }
}
