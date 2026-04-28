"use client";

import React, { useMemo } from "react";
import type {
  Message,
  AssistantMessage,
  UserMessage,
  ReasoningMessage,
  ActivityMessage,
  ToolMessage,
} from "@ag-ui/core";
import {
  CopilotChatReasoningMessage,
  useRenderToolCall,
  useRenderActivityMessage,
  useRenderCustomMessages,
} from "@copilotkit/react-core/v2";

// @region[use-rendered-messages-hook]
export type RenderedMessage = Message & { renderedContent: React.ReactNode };

export function useRenderedMessages(
  messages: Message[],
  isRunning: boolean,
): RenderedMessage[] {
  const renderToolCall = useRenderToolCall();
  const { renderActivityMessage } = useRenderActivityMessage();
  const renderCustomMessage = useRenderCustomMessages();

  return useMemo(() => {
    return messages.map((message): RenderedMessage => {
      const renderedContent = renderMessageContent({
        message,
        messages,
        isRunning,
        renderToolCall,
        renderActivityMessage,
        renderCustomMessage,
      });
      return { ...message, renderedContent } as RenderedMessage;
    });
  }, [
    messages,
    isRunning,
    renderToolCall,
    renderActivityMessage,
    renderCustomMessage,
  ]);
}
// @endregion[use-rendered-messages-hook]

function renderMessageContent(args: {
  message: Message;
  messages: Message[];
  isRunning: boolean;
  renderToolCall: ReturnType<typeof useRenderToolCall>;
  renderActivityMessage: ReturnType<
    typeof useRenderActivityMessage
  >["renderActivityMessage"];
  renderCustomMessage: ReturnType<typeof useRenderCustomMessages>;
}): React.ReactNode {
  const {
    message,
    messages,
    isRunning,
    renderToolCall,
    renderActivityMessage,
    renderCustomMessage,
  } = args;

  if (message.role === "tool") {
    return null;
  }

  const customBefore = renderCustomMessage
    ? renderCustomMessage({ message, position: "before" })
    : null;
  const customAfter = renderCustomMessage
    ? renderCustomMessage({ message, position: "after" })
    : null;

  let body: React.ReactNode = null;

  // @region[manual-activity-message-rendering]
  if (message.role === "assistant") {
    body = renderAssistantBody({
      message: message as AssistantMessage,
      messages,
      renderToolCall,
    });
  } else if (message.role === "user") {
    body = renderUserBody(message as UserMessage);
  } else if (message.role === "reasoning") {
    body = (
      <CopilotChatReasoningMessage
        message={message as ReasoningMessage}
        messages={messages}
        isRunning={isRunning}
      />
    );
  } else if (message.role === "activity") {
    body = renderActivityMessage(message as ActivityMessage);
  }
  // @endregion[manual-activity-message-rendering]

  if (!customBefore && !customAfter) {
    return body;
  }
  return (
    <>
      {customBefore}
      {body}
      {customAfter}
    </>
  );
}

// @region[manual-tool-call-rendering]
function renderAssistantBody(args: {
  message: AssistantMessage;
  messages: Message[];
  renderToolCall: ReturnType<typeof useRenderToolCall>;
}): React.ReactNode {
  const { message, messages, renderToolCall } = args;
  const text = message.content ?? "";
  const hasText = text.trim().length > 0;
  const toolCalls = message.toolCalls ?? [];

  return (
    <>
      {hasText && <div className="whitespace-pre-wrap break-words">{text}</div>}
      {toolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (m) => m.role === "tool" && m.toolCallId === toolCall.id,
        ) as ToolMessage | undefined;
        return (
          <React.Fragment key={toolCall.id}>
            {renderToolCall({ toolCall, toolMessage })}
          </React.Fragment>
        );
      })}
    </>
  );
}
// @endregion[manual-tool-call-rendering]

function renderUserBody(message: UserMessage): React.ReactNode {
  const { content } = message;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  return "";
}
