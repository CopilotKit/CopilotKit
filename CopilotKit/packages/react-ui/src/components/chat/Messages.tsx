import React, { useEffect, useMemo } from "react";
import { MessagesProps } from "./props";
import { useChatContext } from "./ChatContext";
import { nanoid } from "nanoid";
import { Message, decodeResult } from "@copilotkit/shared";
import { Markdown } from "./Markdown";
import { ActionRenderProps, RenderFunctionStatus, useCopilotContext } from "@copilotkit/react-core";

export const Messages = ({ messages, inProgress }: MessagesProps) => {
  const { chatComponentsCache } = useCopilotContext();
  const context = useChatContext();
  const initialMessages = useMemo(
    () => makeInitialMessages(context.labels.initial),
    [context.labels.initial],
  );
  messages = [...initialMessages, ...messages];

  const functionResults: Record<string, string> = {};

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant" && messages[i].function_call) {
      const id = messages[i].id;
      if (i + 1 < messages.length && messages[i + 1].role === "function") {
        functionResults[id] = decodeResult(messages[i + 1].content || "");
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

        if (message.role === "user") {
          return (
            <div key={index} className="copilotKitMessage copilotKitUserMessage">
              {message.content}
            </div>
          );
        } else if (message.role == "assistant") {
          if (isCurrentMessage && inProgress && !message.content && !message.partialFunctionCall) {
            // The message is in progress and there is no content- show the spinner
            return (
              <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
                {context.icons.spinnerIcon}
              </div>
            );
          } else if (message.function_call || message.partialFunctionCall) {
            // Find the action that corresponds to the function call if any
            const functionCallName: string = (message.function_call?.name ||
              message.partialFunctionCall?.name)!;
            if (
              chatComponentsCache.current !== null &&
              chatComponentsCache.current[functionCallName]
            ) {
              const render = chatComponentsCache.current[functionCallName];

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
                const args = message.function_call
                  ? JSON.parse(message.function_call.arguments || "{}")
                  : message.partialFunctionCall?.arguments;

                let status: RenderFunctionStatus = "inProgress";

                if (functionResults[message.id] !== undefined) {
                  status = "complete";
                } else if (message.function_call) {
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
            else if ((!inProgress || !isCurrentMessage) && message.function_call) {
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

          return (
            <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
              <Markdown content={message.content} />
            </div>
          );
        }
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
