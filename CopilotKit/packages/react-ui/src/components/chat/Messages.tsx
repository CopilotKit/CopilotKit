import React, { useEffect } from "react";
import { MessagesProps } from "./props";
import { useTemporaryContext } from "./TemporaryContext";

export const Messages: React.FC<MessagesProps> = ({ messages, inProgress }) => {
  const context = useTemporaryContext();
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
                {message.content}
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
