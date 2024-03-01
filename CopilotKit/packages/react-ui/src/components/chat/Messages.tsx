import React, { useEffect, useMemo } from "react";
import { MessagesProps } from "./props";
import { useChatContext } from "./ChatContext";
import { nanoid } from "nanoid";
import { Message } from "@copilotkit/shared";
import { Markdown } from "./Markdown";
import { useCopilotContext } from "@copilotkit/react-core";

export const Messages = ({ messages, inProgress }: MessagesProps) => {
  const { entryPoints } = useCopilotContext();
  const context = useChatContext();
  const initialMessages = useMemo(
    () => makeInitialMessages(context.labels.initial),
    [context.labels.initial],
  );
  messages = [...initialMessages, ...messages];

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "auto",
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="copilotKitMessages">
      {messages.map((message, index) => {
        const isCurrentMessage = index === messages.length - 1;

        if (message.role === "user") {
          return (
            <div key={index} className="copilotKitMessage copilotKitUserMessage">
              {message.content}
            </div>
          );
        } else if (message.role == "assistant") {
          if (isCurrentMessage && inProgress && !message.content) {
            let inProgressLabel = "";

            if (message.partialFunctionCall) {
              for (const action of Object.values(entryPoints)) {
                if (action.name === message.partialFunctionCall.name && action.inProgressLabel) {
                  // the label is a function, call it with the arguments
                  if (typeof action.inProgressLabel === "function") {
                    inProgressLabel = action.inProgressLabel(
                      message.partialFunctionCall.arguments as any,
                      // if function_call is undefined, the arguments are incomplete
                      message.function_call !== undefined,
                    );
                  }
                  // the label is a string
                  else {
                    // (don't do an additional type check so we get a compile error if we add a new type)
                    inProgressLabel = action.inProgressLabel;
                  }
                }
              }
            }
            return (
              <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
                {context.icons.spinnerIcon}
                {inProgressLabel && <span className="inProgressLabel">{inProgressLabel}</span>}
              </div>
            );
          } else if (
            (!inProgress || index != messages.length - 1) &&
            !message.content &&
            message.function_call
          ) {
            return (
              <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
                {context.labels.done}
              </div>
            );
          }
          // TODO: Add back partial message
          // This shows up when the assistant is executing a function
          //
          // else if (message.status === "partial") {
          //   return (
          //     <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
          //       {context.labels.thinking} {context.icons.spinnerIcon}
          //     </div>
          //   );
          // }
          else {
            return (
              <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
                <Markdown content={message.content} />
              </div>
            );
          }
        }
        // TODO: Add back function and error messages
        //
        // else if (message.role === "function" && message.status === "success") {
        //   return (
        //     <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
        //       {context.labels.done}
        //     </div>
        //   );
        // } else if (message.status === "error") {
        //   return (
        //     <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
        //       {context.labels.error}
        //     </div>
        //   );
        // }
      })}
      <div ref={messagesEndRef} />
    </div>
  );
};

function makeInitialMessages(initial?: string | string[]): Message[] {
  let initialArray: string[] = [];
  if (initial) {
    if (Array.isArray(initial)) {
      initialArray.push(...initial);
    } else {
      initialArray.push(initial);
    }
  }

  return initialArray.map((message) => ({
    id: nanoid(),
    role: "assistant",
    content: message,
  }));
}
