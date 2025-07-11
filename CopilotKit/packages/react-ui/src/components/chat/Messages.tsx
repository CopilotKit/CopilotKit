import { useMemo } from "react";
import { MessagesProps } from "./props";
import { useChatContext } from "./ChatContext";
import { Message, Role, TextMessage, gqlToAGUI } from "@copilotkit/runtime-client-gql";
import { useCopilotChat } from "@copilotkit/react-core";
import { StickToBottom } from "use-stick-to-bottom";

export const Messages = ({
  children,
  inProgress,
  RenderTextMessage,
  AssistantMessage,
  UserMessage,
  ImageRenderer,
  onRegenerate,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  markdownTagRenderers,
}: MessagesProps) => {
  const { labels } = useChatContext();
  const { visibleMessages, interrupt } = useCopilotChat();

  const initialMessages = useMemo(() => makeInitialMessages(labels.initial), [labels.initial]);

  const messages = [...gqlToAGUI(initialMessages), ...visibleMessages];

  return (
    <StickToBottom resize="smooth" initial="smooth" className="copilotKitMessages">
      <StickToBottom.Content className="copilotKitMessagesContainer">
        {messages.map((message, index) => {
          const isCurrentMessage = index === messages.length - 1;

          // Handle all message types through the RenderTextMessage component
          // Image messages will be handled by the UserMessage and AssistantMessage components
          return (
            <RenderTextMessage
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
          {
            interrupt;
          }
        })}
      </StickToBottom.Content>
      {children}
    </StickToBottom>
  );
};

function makeInitialMessages(initial: string | string[] | undefined): Message[] {
  if (!initial) return [];

  if (Array.isArray(initial)) {
    return initial.map(
      (message) =>
        new TextMessage({
          role: Role.Assistant,
          content: message,
        }),
    );
  }

  return [
    new TextMessage({
      content: initial,
      role: Role.System,
    }),
  ];
}
