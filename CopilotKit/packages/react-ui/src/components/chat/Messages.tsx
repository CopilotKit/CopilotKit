import { useEffect, useMemo, useRef } from "react";
import { MessagesProps } from "./props";
import { useChatContext } from "./ChatContext";
import { Message } from "@copilotkit/shared";
import { useCopilotChatInternal as useCopilotChat } from "@copilotkit/react-core";
import { LegacyRenderMessage, LegacyRenderProps } from "./messages/LegacyRenderMessage";

export const Messages = ({
  inProgress,
  children,
  RenderMessage,
  AssistantMessage,
  UserMessage,
  ImageRenderer,
  onRegenerate,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  markdownTagRenderers,

  // Legacy props
  RenderTextMessage,
  RenderActionExecutionMessage,
  RenderAgentStateMessage,
  RenderResultMessage,
  RenderImageMessage,
}: MessagesProps) => {
  const { labels } = useChatContext();
  const { messages: visibleMessages, interrupt } = useCopilotChat();
  const initialMessages = useMemo(() => makeInitialMessages(labels.initial), [labels.initial]);
  const messages = [...initialMessages, ...visibleMessages];
  const { messagesContainerRef, messagesEndRef } = useScrollToBottom(messages);

  // Check if any legacy props are provided
  const hasLegacyProps = !!(
    RenderTextMessage ||
    RenderActionExecutionMessage ||
    RenderAgentStateMessage ||
    RenderResultMessage ||
    RenderImageMessage
  );

  // Show deprecation warning if legacy props are used
  useEffect(() => {
    if (hasLegacyProps) {
      console.warn(
        "[CopilotKit] Legacy message render props (RenderTextMessage, RenderActionExecutionMessage, etc.) are deprecated. " +
          "Please use the unified 'RenderMessage' prop instead. " +
          "See migration guide: https://docs.copilotkit.ai/migration/render-message",
      );
    }
  }, [hasLegacyProps]);

  // Create legacy props object for the adapter
  const legacyProps: LegacyRenderProps = useMemo(
    () => ({
      RenderTextMessage,
      RenderActionExecutionMessage,
      RenderAgentStateMessage,
      RenderResultMessage,
      RenderImageMessage,
    }),
    [
      RenderTextMessage,
      RenderActionExecutionMessage,
      RenderAgentStateMessage,
      RenderResultMessage,
      RenderImageMessage,
    ],
  );

  // Determine which render component to use
  const MessageRenderer = hasLegacyProps
    ? (props: any) => <LegacyRenderMessage {...props} legacyProps={legacyProps} />
    : RenderMessage;

  return (
    <div className="copilotKitMessages" ref={messagesContainerRef}>
      <div className="copilotKitMessagesContainer">
        {messages.map((message, index) => {
          const isCurrentMessage = index === messages.length - 1;
          return (
            <MessageRenderer
              key={index}
              message={message}
              inProgress={inProgress}
              index={index}
              isCurrentMessage={isCurrentMessage}
              AssistantMessage={AssistantMessage}
              UserMessage={UserMessage}
              ImageRenderer={ImageRenderer}
              onRegenerate={onRegenerate}
              onCopy={onCopy}
              onThumbsUp={onThumbsUp}
              onThumbsDown={onThumbsDown}
              markdownTagRenderers={markdownTagRenderers}
            />
          );
        })}
        {interrupt}
      </div>
      <footer className="copilotKitMessagesFooter" ref={messagesEndRef}>
        {children}
      </footer>
    </div>
  );
};

function makeInitialMessages(initial: string | string[] | undefined): Message[] {
  if (!initial) return [];

  if (Array.isArray(initial)) {
    return initial.map((message) => {
      return {
        id: message,
        role: "assistant",
        content: message,
      };
    });
  }

  return [
    {
      id: initial,
      role: "assistant",
      content: initial,
    },
  ];
}

export function useScrollToBottom(messages: Message[]) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const isUserScrollUpRef = useRef(false);

  const scrollToBottom = () => {
    if (messagesContainerRef.current && messagesEndRef.current) {
      isProgrammaticScrollRef.current = true;
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  const handleScroll = () => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }

    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      isUserScrollUpRef.current = scrollTop + clientHeight < scrollHeight;
    }
  };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
    }
    return () => {
      if (container) {
        container.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const mutationObserver = new MutationObserver(() => {
      if (!isUserScrollUpRef.current) {
        scrollToBottom();
      }
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      mutationObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    isUserScrollUpRef.current = false;
    scrollToBottom();
  }, [messages.filter((m) => m.role === "user").length]);

  return { messagesEndRef, messagesContainerRef };
}
