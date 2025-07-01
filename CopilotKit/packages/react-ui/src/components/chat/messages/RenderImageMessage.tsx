import { RenderMessageProps } from "../props";
import { UserMessage as DefaultUserMessage } from "./UserMessage";
import { AssistantMessage as DefaultAssistantMessage } from "./AssistantMessage";

export function RenderImageMessage({
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
    canRegenerateAssistantMessage,
    canCopyAssistantMessage,
    disableFirstAssistantMessageControls = true
  } = props;

  if (message.isImageMessage()) {
    const imageData = `data:${message.format};base64,${message.bytes}`;
    const imageComponent = (
      <div className="copilotKitImage">
        <img
          src={imageData}
          alt="User uploaded image"
          style={{ maxWidth: "100%", maxHeight: "300px", borderRadius: "8px" }}
        />
      </div>
    );

    if (message.role === "user") {
      return (
        <UserMessage
          key={index}
          data-message-role="user"
          message=""
          rawData={message}
          subComponent={imageComponent}
        />
      );
    } else if (message.role === "assistant") {
      return (
        <AssistantMessage
          key={index}
          index={index}
          message=""
          rawData={message}
          subComponent={imageComponent}
          isLoading={inProgress && isCurrentMessage && !message.bytes}
          isGenerating={inProgress && isCurrentMessage && !!message.bytes}
          isCurrentMessage={isCurrentMessage}
          onRegenerate={() => onRegenerate?.(message.id)}
          onCopy={onCopy}
          onThumbsUp={onThumbsUp}
          onThumbsDown={onThumbsDown}
          canRegenerate={canRegenerateAssistantMessage}
          canCopy={canCopyAssistantMessage}
          disableFirstMessageControls={disableFirstAssistantMessageControls && index === 0}
        />
      );
    }
  }

  return null;
}
