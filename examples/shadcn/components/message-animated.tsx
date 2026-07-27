"use client";

import { useRenderToolCall } from "@copilotkit/react-core/v2";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";

type MessageAnimatedPart = {
  text?: string;
  type?: string;
};

type MessageAnimatedMessage = {
  content?: unknown;
  id?: string;
  parts?: ReadonlyArray<MessageAnimatedPart>;
  role?: string;
  text?: string;
  toolCallId?: string;
  toolCalls?: MessageAnimatedToolCall[];
};

type MessageAnimatedToolCall = {
  id: string;
  type: "function";
  function: {
    arguments: string;
    name: string;
  };
};

type MessageAnimatedToolMessage = MessageAnimatedMessage & {
  content: string;
  id: string;
  role: "tool";
  toolCallId: string;
};

type MessageAnimatedTextPart = {
  key: string;
  text: string;
};

type MessageAnimatedScrollerItemProps = Omit<
  React.ComponentProps<typeof MessageScrollerItem>,
  "children" | "messageId"
>;

type MotionScrollerItemProps = Omit<
  MessageAnimatedScrollerItemProps,
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onAnimationStart"
  | "onDrag"
  | "onDragEnd"
  | "onDragStart"
>;

const MessageAnimatedMessagesContext = React.createContext<
  MessageAnimatedMessage[]
>([]);

// The animated wrapper still renders the installed ShadCN MessageScrollerItem.
const MotionMessageScrollerItem = motion.create(MessageScrollerItem);

function MessageAnimatedMessagesProvider({
  children,
  messages,
}: {
  children: React.ReactNode;
  messages: MessageAnimatedMessage[];
}) {
  return (
    <MessageAnimatedMessagesContext.Provider value={messages}>
      {children}
    </MessageAnimatedMessagesContext.Provider>
  );
}

function MessageAnimated({
  assistantVariant = "ghost",
  message,
  scrollAnchor,
  userVariant = "muted",
  ...props
}: MessageAnimatedScrollerItemProps & {
  assistantVariant?: React.ComponentProps<typeof Bubble>["variant"];
  message: MessageAnimatedMessage;
  userVariant?: React.ComponentProps<typeof Bubble>["variant"];
}) {
  const isUserMessage = message.role === "user";
  const prefersReducedMotion = useReducedMotion();
  const motionItemProps = getMotionScrollerItemProps(props);
  const row = (
    <MessageAnimatedRow
      message={message}
      assistantVariant={assistantVariant}
      userVariant={userVariant}
    />
  );

  if (isUserMessage && !prefersReducedMotion) {
    return (
      <MotionMessageScrollerItem
        messageId={message.id}
        scrollAnchor={scrollAnchor ?? true}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
        {...motionItemProps}
      >
        {row}
      </MotionMessageScrollerItem>
    );
  }

  return (
    <MessageScrollerItem
      messageId={message.id}
      scrollAnchor={scrollAnchor ?? isUserMessage}
      {...props}
    >
      {row}
    </MessageScrollerItem>
  );
}

function MessageAnimatedLoading({
  label = "Thinking and parsing...",
}: {
  label?: string;
}) {
  return (
    <MessageScrollerItem messageId="assistant-loading" scrollAnchor>
      <Message align="start" role="status" aria-live="polite">
        <MessageContent>
          <Bubble variant="ghost">
            <BubbleContent>
              <span className="shimmer shimmer-duration-1600 text-muted-foreground">
                {label}
              </span>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

function getMotionScrollerItemProps(
  props: MessageAnimatedScrollerItemProps,
): MotionScrollerItemProps {
  const motionProps = { ...props };

  delete motionProps.onAnimationEnd;
  delete motionProps.onAnimationIteration;
  delete motionProps.onAnimationStart;
  delete motionProps.onDrag;
  delete motionProps.onDragEnd;
  delete motionProps.onDragStart;

  return motionProps as MotionScrollerItemProps;
}

function MessageAnimatedRow({
  assistantVariant,
  message,
  userVariant,
}: {
  assistantVariant: React.ComponentProps<typeof Bubble>["variant"];
  message: MessageAnimatedMessage;
  userVariant: React.ComponentProps<typeof Bubble>["variant"];
}) {
  const renderToolCall = useRenderToolCall();
  const allMessages = React.useContext(MessageAnimatedMessagesContext);
  const isUserMessage = message.role === "user";
  const textParts = getMessageAnimatedTextParts(message);
  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const visibleToolCalls = getVisibleToolCalls(toolCalls);

  return (
    <Message align={isUserMessage ? "end" : "start"}>
      <MessageContent>
        {textParts.map((part) => {
          const paragraphs = part.text
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean);

          return (
            <Bubble
              key={part.key}
              variant={isUserMessage ? userVariant : assistantVariant}
            >
              <BubbleContent className="space-y-2">
                {paragraphs.map((paragraph, paragraphIndex) => (
                  <p
                    key={`${part.key}-${paragraphIndex}`}
                    className="whitespace-pre-wrap"
                  >
                    {paragraph}
                  </p>
                ))}
              </BubbleContent>
            </Bubble>
          );
        })}
        {visibleToolCalls.map((toolCall) => (
          <div key={toolCall.id} className="w-full max-w-full">
            {renderToolCall({
              toolCall,
              toolMessage: findToolMessage(allMessages, toolCall.id),
            })}
          </div>
        ))}
      </MessageContent>
    </Message>
  );
}

function getVisibleToolCalls(toolCalls: MessageAnimatedToolCall[]) {
  let hasRenderedChart = false;

  return toolCalls.filter((toolCall) => {
    if (!isChartToolCall(toolCall)) {
      return true;
    }

    if (hasRenderedChart) {
      return false;
    }

    hasRenderedChart = true;
    return true;
  });
}

function isChartToolCall(toolCall: MessageAnimatedToolCall) {
  return toolCall.function.name === "renderLineChart";
}

function findToolMessage(
  messages: MessageAnimatedMessage[],
  toolCallId: string,
): MessageAnimatedToolMessage | undefined {
  const message = messages.find(
    (candidate): candidate is MessageAnimatedToolMessage =>
      candidate.role === "tool" &&
      typeof candidate.id === "string" &&
      candidate.toolCallId === toolCallId &&
      typeof candidate.content === "string",
  );

  return message;
}

function getMessageAnimatedTextParts(
  message: MessageAnimatedMessage,
): MessageAnimatedTextPart[] {
  if (message.parts) {
    return message.parts.flatMap((part, index) => {
      if (part.type !== "text" || typeof part.text !== "string") {
        return [];
      }

      return [{ key: `${message.id ?? "message"}-${index}`, text: part.text }];
    });
  }

  if (typeof message.text === "string") {
    return [{ key: `${message.id ?? "message"}-text`, text: message.text }];
  }

  return contentToTextParts(message.id, message.content);
}

function contentToTextParts(
  messageId: string | undefined,
  content: unknown,
): MessageAnimatedTextPart[] {
  if (typeof content === "string") {
    return [{ key: `${messageId ?? "message"}-content`, text: content }];
  }

  if (Array.isArray(content)) {
    return content.flatMap((part, index) => {
      if (typeof part === "string") {
        return [{ key: `${messageId ?? "message"}-${index}`, text: part }];
      }

      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return [{ key: `${messageId ?? "message"}-${index}`, text: part.text }];
      }

      return [];
    });
  }

  return content
    ? [
        {
          key: `${messageId ?? "message"}-json`,
          text: JSON.stringify(content, null, 2),
        },
      ]
    : [];
}

export {
  MessageAnimated,
  MessageAnimatedLoading,
  MessageAnimatedMessagesProvider,
  type MessageAnimatedMessage,
};
