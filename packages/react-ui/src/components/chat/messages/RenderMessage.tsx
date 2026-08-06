import { RenderMessageProps } from "../props";
import { UserMessage as DefaultUserMessage } from "./UserMessage";
import { AssistantMessage as DefaultAssistantMessage } from "./AssistantMessage";
import { ImageRenderer as DefaultImageRenderer } from "./ImageRenderer";

export function RenderMessage({
  UserMessage = DefaultUserMessage,
  AssistantMessage = DefaultAssistantMessage,
  ImageRenderer = DefaultImageRenderer,
  ...props
}: RenderMessageProps) {
  const {
    message,
    messages,
    inProgress,
    index,
    isCurrentMessage,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    messageFeedback,
    markdownTagRenderers,
  } = props;

  const hasContent =
    typeof message.content === "string"
      ? message.content.length > 0
      : typeof message.content === "object" && message.content !== null
        ? Object.keys(message.content).length > 0
        : !!message.content;

  switch (message.role) {
    case "user":
      return (
        <UserMessage
          key={index}
          rawData={message}
          data-message-role="user"
          message={message}
          ImageRenderer={ImageRenderer}
        />
      );
    case "assistant":
      return (
        <AssistantMessage
          key={index}
          data-message-role="assistant"
          subComponent={message.generativeUI?.()}
          rawData={message}
          message={message}
          messages={messages}
          isLoading={inProgress && isCurrentMessage && !hasContent}
          isGenerating={inProgress && isCurrentMessage && hasContent}
          isCurrentMessage={isCurrentMessage}
          onRegenerate={() => onRegenerate?.(message.id)}
          onCopy={onCopy}
          onThumbsUp={onThumbsUp}
          onThumbsDown={onThumbsDown}
          feedback={messageFeedback?.[message.id] || null}
          markdownTagRenderers={markdownTagRenderers}
          ImageRenderer={ImageRenderer}
        />
      );
    default:
      return null;
  }
}
