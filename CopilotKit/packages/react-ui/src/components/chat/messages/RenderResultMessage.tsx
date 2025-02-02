import { RenderMessageProps } from "../props";

export function RenderResultMessage(props: RenderMessageProps) {
  const { message, inProgress, index, isCurrentMessage, AssistantMessage } = props;

  if (message.isResultMessage() && inProgress && isCurrentMessage) {
    return (
      <AssistantMessage
        key={index}
        data-message-role="assistant"
        rawData={message}
        isLoading={true}
        isGenerating={true}
      />
    );
  }
}
