import { ResultMessage } from "@copilotkit/runtime-client-gql";
import { RenderMessageProps } from "../props";
import { useChatContext } from "../ChatContext";

export function RenderResultMessage(props: RenderMessageProps) {
  const { message, inProgress, index, isCurrentMessage } = props;
  const { icons } = useChatContext();
  if (message instanceof ResultMessage && inProgress && isCurrentMessage) {
    return (
      <div key={index} className={`copilotKitMessage copilotKitAssistantMessage`}>
        {icons.spinnerIcon}
      </div>
    );
  }
}
