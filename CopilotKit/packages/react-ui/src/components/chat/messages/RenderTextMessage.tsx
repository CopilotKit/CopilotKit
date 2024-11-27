import { TextMessage } from "@copilotkit/runtime-client-gql";
import { RenderMessageProps } from "../props";
import { Markdown } from "../Markdown";
import { useChatContext } from "../ChatContext";

export function RenderTextMessage(props: RenderMessageProps) {
  const { message, inProgress, index, isCurrentMessage } = props;
  const { icons } = useChatContext();
  if (message.isTextMessage()) {
    if (message.role === "user") {
      return (
        <div
          key={index}
          data-message-role="user"
          className="copilotKitMessage copilotKitUserMessage"
        >
          {message.content}
        </div>
      );
    } else if (message.role == "assistant") {
      return (
        <div
          key={index}
          data-message-role="assistant"
          className={`copilotKitMessage copilotKitAssistantMessage`}
        >
          {isCurrentMessage && inProgress && !message.content ? (
            icons.spinnerIcon
          ) : (
            <Markdown content={message.content} />
          )}
        </div>
      );
    }
  }
}
