import { RenderMessageProps } from "../props";
import { UserMessage as DefaultUserMessage } from "./UserMessage";
import { AssistantMessage as DefaultAssistantMessage } from "./AssistantMessage";

export function RenderTextMessage({
  UserMessage = DefaultUserMessage,
  AssistantMessage = DefaultAssistantMessage,
  ...props
}: RenderMessageProps) {
  const {
    message,
    inProgress,
    index,
    isCurrentMessage,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
  } = props;

  if (message.isTextMessage()) {
    if (message.role === "user") {
      return (
        <UserMessage
          key={index}
          data-message-role="user"
          message={message.content}
          rawData={message}
        />
      );
    } else if (message.role == "assistant") {
      return (
        <AssistantMessage
          key={index}
          data-message-role="assistant"
          message={message.content}
          rawData={message}
          isLoading={inProgress && isCurrentMessage && !message.content}
          isGenerating={inProgress && isCurrentMessage && !!message.content}
          isCurrentMessage={isCurrentMessage}
          onRegenerate={onRegenerate}
          onCopy={onCopy}
          onThumbsUp={onThumbsUp}
          onThumbsDown={onThumbsDown}
        />
      );
    }
  }
}
