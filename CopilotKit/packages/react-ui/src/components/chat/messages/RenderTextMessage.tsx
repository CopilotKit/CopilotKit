import { RenderMessageProps } from "../props";

export function RenderTextMessage(props: RenderMessageProps) {
  const {
    message,
    inProgress,
    index,
    isCurrentMessage,
    UserMessage,
    AssistantMessage,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
  } = props;

  const noop = () => {};

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
          onRegenerate={onRegenerate ?? noop}
          onCopy={onCopy ?? noop}
          onThumbsUp={onThumbsUp ?? noop}
          onThumbsDown={onThumbsDown ?? noop}
        />
      );
    }
  }
}
