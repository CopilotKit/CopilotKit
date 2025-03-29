import { RenderMessageProps } from "../props";
import { AssistantMessage as DefaultAssistantMessage } from "./AssistantMessage";

export function RenderResultMessage({
  AssistantMessage = DefaultAssistantMessage,
  ...props
}: RenderMessageProps) {
  const { message, inProgress, index, isCurrentMessage } = props;

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

  // Avoid 'Nothing was returned from render' React error
  else {
    return null;
  }
}
