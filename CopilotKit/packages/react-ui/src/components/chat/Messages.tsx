import React, { useEffect, useMemo } from "react";
import { MessagesProps } from "./props";
import { useChatContext } from "./ChatContext";
import { nanoid } from "nanoid";
import { Message } from "@copilotkit/shared";
import { Markdown } from "./Markdown";

export const Messages = ({ messages, inProgress }: MessagesProps) => {
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
            return (
              <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
                {context.icons.spinnerIcon}
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
