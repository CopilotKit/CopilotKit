import { RenderMessageProps } from "../props";

export function RenderTextMessage(props: RenderMessageProps) {
  const { message, inProgress, index, isCurrentMessage, UserMessage, AssistantMessage } = props;

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
        />
      );
    }
  }
}
