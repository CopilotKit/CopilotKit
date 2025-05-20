import { MessageStatusCode } from "@copilotkit/runtime-client-gql";
import { RenderMessageProps } from "../props";
import { RenderFunctionStatus, useCopilotContext, ActionRenderProps } from "@copilotkit/react-core";
import { AssistantMessage as DefaultAssistantMessage } from "./AssistantMessage";

// Custom type that extends the action render props with our actionId
type ActionRenderArgsWithId = ActionRenderProps & {
  actionId: string;
};

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
          // Create render arguments including the actionId
          const renderArgs = {
            status: status as any,
            args,
            result: actionResult,
            name: message.name,
            actionId: message.id,
          } as ActionRenderArgsWithId;
          
          // Check for current action context
          const currentActionMessageId = (window as any).__COPILOT_CURRENT_ACTION_MESSAGE_ID__;
          const currentActionName = (window as any).__COPILOT_CURRENT_ACTION_NAME__;
          
          // Check if this is our currently executing message
          const isCurrentlyExecuting = currentActionMessageId === message.id && currentActionName === message.name;
          if (isCurrentlyExecuting) {
            // If executing status but no actionResult yet, ensure we're in executing
            if (status !== "complete" && actionResult === undefined) {
              status = "executing";
              (renderArgs as any).status = status;
            } else if (actionResult !== undefined) {
              // If we have a result, we should be in complete state
              status = "complete";
              (renderArgs as any).status = status;
            }
          } else if (status === "executing" && !isCurrentlyExecuting) {
            // If we think we're executing but the system isn't currently executing this message,
            // check how long it's been since this message was created
            const messageTime = message.createdAt;
            const now = new Date();
            const timeSinceCreation = now.getTime() - messageTime.getTime();
            
            // Force complete state if we have an action result
            if (actionResult !== undefined) {
              status = "complete";
              (renderArgs as any).status = status;
            }
            // If it's been more than 3 seconds since creation and we're not the active message,
            // but we're still in "executing" state, it's likely a stale state - fallback to inProgress
            else if (timeSinceCreation > 3000) {
              status = "inProgress";
              (renderArgs as any).status = status;
            }
          }
          
          try {
            const toRender = render(renderArgs as any);
            
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
                  data-action-name={message.name}
                  data-message-id={message.id}
                  data-status={status}
                  key={index}
                  isLoading={false}
                  isGenerating={status === "executing"}
                  subComponent={toRender}
                />
              );
            }
          } catch (innerError) {
            // If render function throws an error while rendering, try falling back to inProgress
            // If we got error in executing state, try with inProgress
            if (status === "executing") {
              try {
                const fallbackRenderArgs = {
                  ...renderArgs,
                  status: "inProgress" as any
                };
                
                const fallbackResult = render(fallbackRenderArgs as any);
                // Handle string vs React Element correctly
                if (fallbackResult) {
                  if (typeof fallbackResult === "string") {
                    return (
                      <AssistantMessage
                        rawData={message}
                        data-message-role="assistant"
                        key={index}
                        isLoading={false}
                        isGenerating={true}
                        message={fallbackResult}
                      />
                    );
                  } else {
                    return (
                      <AssistantMessage
                        rawData={message}
                        data-message-role="action-render"
                        data-action-name={message.name}
                        data-message-id={message.id}
                        data-status="inProgress"
                        key={index}
                        isLoading={false}
                        isGenerating={true}
                        subComponent={fallbackResult}
                      />
                    );
                  }
                }
              } catch (fallbackError) {
                // Fall through to the error handler below
              }
            }
            
            // If fallback didn't work, show error
            throw innerError;
          }
        } catch (e) {
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
  
  return null;
}
