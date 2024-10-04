import React, { useEffect, useMemo } from "react";
import { MessagesProps } from "./props";
import { useChatContext } from "./ChatContext";
import {
  ActionExecutionMessage,
  Message,
  ResultMessage,
  TextMessage,
  Role,
  AgentStateMessage,
} from "@copilotkit/runtime-client-gql";

export const Messages = ({
  messages,
  inProgress,
  children,
  RenderTextMessage,
  RenderActionExecutionMessage,
  RenderAgentStateMessage,
  RenderResultMessage,
}: MessagesProps) => {
  const context = useChatContext();
  const initialMessages = useMemo(
    () => makeInitialMessages(context.labels.initial),
    [context.labels.initial],
  );
  messages = [...initialMessages, ...messages];

  const actionResults: Record<string, string> = {};

  for (let i = 0; i < messages.length; i++) {
    if (messages[i] instanceof ActionExecutionMessage) {
      const id = messages[i].id;
      const resultMessage: ResultMessage | undefined = messages.find(
        (message) => message instanceof ResultMessage && message.actionExecutionId === id,
      ) as ResultMessage | undefined;

      if (resultMessage) {
        actionResults[id] = ResultMessage.decodeResult(resultMessage.result || "");
      }
    }
  }

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

        if (message instanceof TextMessage) {
          return (
            <RenderTextMessage
              key={index}
              message={message}
              inProgress={inProgress}
              index={index}
              isCurrentMessage={isCurrentMessage}
            />
          );
        } else if (message instanceof ActionExecutionMessage) {
          return (
            <RenderActionExecutionMessage
              key={index}
              message={message}
              inProgress={inProgress}
              index={index}
              isCurrentMessage={isCurrentMessage}
              actionResult={actionResults[message.id]}
            />
          );
        } else if (message instanceof AgentStateMessage) {
          return (
            <RenderAgentStateMessage
              key={index}
              message={message}
              inProgress={inProgress}
              index={index}
              isCurrentMessage={isCurrentMessage}
            />
          );
        } else if (message instanceof ResultMessage) {
          return (
            <RenderResultMessage
              key={index}
              message={message}
              inProgress={inProgress}
              index={index}
              isCurrentMessage={isCurrentMessage}
            />
          );
        }
      })}
      <footer ref={messagesEndRef}>{children}</footer>
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

  return initialArray.map(
    (message) =>
      new TextMessage({
        role: Role.Assistant,
        content: message,
      }),
  );
}
