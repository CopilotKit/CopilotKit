import React, { useEffect, useMemo } from "react";
import { MessagesProps, SuggestionsProps } from "./props";
import { useChatContext } from "./ChatContext";
import { nanoid } from "nanoid";
import {
  ActionExecutionMessage,
  IMessage,
  ResultMessage,
  TextMessage,
  decodeResult,
} from "@copilotkit/shared";
import { Markdown } from "./Markdown";
import { RenderFunctionStatus, useCopilotContext } from "@copilotkit/react-core";

export const Messages = ({ messages, inProgress, children }: MessagesProps) => {
  const { chatComponentsCache } = useCopilotContext();
  const context = useChatContext();
  const initialMessages = useMemo(
    () => makeInitialMessages(context.labels.initial),
    [context.labels.initial],
  );
  messages = [...initialMessages, ...messages];

  const functionResults: Record<string, string> = {};

  for (let i = 0; i < messages.length; i++) {
    if (messages[i] instanceof ActionExecutionMessage) {
      const id = messages[i].id;
      const resultMessage: ResultMessage | undefined = messages.find(
        (message) => message instanceof ResultMessage && message.actionExecutionId === id,
      ) as ResultMessage | undefined;

      if (resultMessage) {
        functionResults[id] = decodeResult(resultMessage.result || "");
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

        if (message instanceof TextMessage && message.role === "user") {
          return (
            <div key={index} className="copilotKitMessage copilotKitUserMessage">
              {message.content}
            </div>
          );
        } else if (message instanceof TextMessage && message.role == "assistant") {
          return (
            <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
              {isCurrentMessage && inProgress && !message.content ? (
                context.icons.spinnerIcon
              ) : (
                <Markdown content={message.content} />
              )}
            </div>
          );
        } else if (message instanceof ActionExecutionMessage) {
          if (chatComponentsCache.current !== null && chatComponentsCache.current[message.name]) {
            const render = chatComponentsCache.current[message.name];
            // render a static string
            if (typeof render === "string") {
              // when render is static, we show it only when in progress
              if (isCurrentMessage && inProgress) {
                return (
                  <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
                    {context.icons.spinnerIcon} <span className="inProgressLabel">{render}</span>
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

              if (functionResults[message.id] !== undefined) {
                status = "complete";
              } else if (message.isStreaming) {
                status = "executing";
              }

              const toRender = render({
                status: status as any,
                args,
                result: functionResults[message.id],
              });

              // No result and complete: stay silent
              if (!toRender && status === "complete") {
                return null;
              }

              if (typeof toRender === "string") {
                return (
                  <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
                    {isCurrentMessage && inProgress && context.icons.spinnerIcon} {toRender}
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
                {context.icons.spinnerIcon}
              </div>
            );
          }
        }
      })}
      <footer ref={messagesEndRef}>{children}</footer>
    </div>
  );
};

function makeInitialMessages(initial?: string | string[]): IMessage[] {
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
        id: nanoid(),
        role: "assistant",
        content: message,
        isStreaming: false,
        createdAt: new Date(),
      }),
  );
}
