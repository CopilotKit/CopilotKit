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

/**
 * Manual per-message composition for the TRULY headless chat cell.
 *
 * This hook mirrors — line-for-line in spirit — the role-dispatch that happens
 * inside `renderMessageBlock` in the canonical primitive:
 *
 *   packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx:542-612
 *
 * The point of this cell is to demonstrate that the FULL generative-UI weave
 * (assistant text + tool-call renders + reasoning + activity + custom before /
 * after slots) can be re-composed from the low-level hooks directly, without
 * importing `<CopilotChatMessageView>` or `<CopilotChatAssistantMessage>`.
 * Only the reasoning-message LEAF component is imported — it's a pure
 * presentational primitive, not a dispatcher.
 *
 * Return shape: the original messages, each augmented with a `renderedContent`
 * field that the parent list drops directly into a `<UserBubble>` or
 * `<AssistantBubble>` chrome wrapper.
 *
 * Text rendering: we intentionally use plain text (a `<div>` with
 * `whitespace-pre-wrap`) rather than a markdown pipeline. Rationale: the cell's
 * goal is to show what "truly headless" looks like — every piece of composition
 * lives in user code — so pulling in a markdown library here would re-hide
 * a chunk of formatting decisions behind an opaque black box. Apps that want
 * markdown can drop Streamdown / react-markdown in at this exact line.
 */
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
    // `renderToolCall`, `renderActivityMessage`, and `renderCustomMessage` are
    // callbacks produced by their respective hooks; their identity turns over
    // whenever the underlying registries / agent / config change, which is
    // exactly when we want to recompute.
  }, [
    messages,
    isRunning,
    renderToolCall,
    renderActivityMessage,
    renderCustomMessage,
  ]);
}

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

  // Tool-role messages carry a tool-call RESULT whose UI lives inline inside
  // the PRECEDING assistant message's `toolCalls[i]` render (keyed by
  // toolCallId). We return null here so the list skips them, mirroring the
  // fact that CopilotChatMessageView's `renderMessageBlock` has no
  // `message.role === "tool"` branch.
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
        // Tool result lives on a sibling `tool`-role message keyed by toolCallId.
        // Mirrors CopilotChatToolCallsView (react-core/v2/components/chat/CopilotChatToolCallsView.tsx).
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

function renderUserBody(message: UserMessage): React.ReactNode {
  // AG-UI user messages may carry a string OR an array of parts (text, image,
  // audio, video, document, binary). The headless cell renders only the text
  // parts — swap this for a richer renderer when you need attachments.
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
