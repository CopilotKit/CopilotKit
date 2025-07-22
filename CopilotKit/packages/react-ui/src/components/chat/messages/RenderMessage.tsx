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
    inProgress,
    index,
    isCurrentMessage,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    markdownTagRenderers,
    canRegenerateAssistantMessage,
    canCopyAssistantMessage,
    disableFirstAssistantMessageControls = true,
  } = props;

  switch (message.role) {
    case "user":
      return (
        <UserMessage
          key={index}
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
          message={message}
          isLoading={inProgress && isCurrentMessage && !message.content}
          isGenerating={inProgress && isCurrentMessage && !!message.content}
          isCurrentMessage={isCurrentMessage}
          onRegenerate={() => onRegenerate?.(message.id)}
          onCopy={onCopy}
          onThumbsUp={onThumbsUp}
          onThumbsDown={onThumbsDown}
          markdownTagRenderers={markdownTagRenderers}
          canRegenerate={canRegenerateAssistantMessage}
          canCopy={canCopyAssistantMessage}
          disableFirstMessageControls={disableFirstAssistantMessageControls && index === 0}
          ImageRenderer={ImageRenderer}
        />
      );
  }
}
