import { AssistantMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { Markdown } from "../Markdown";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { icons } = useChatContext();
  const { message, isLoading, subComponent } = props;

  return (
    <>
      {(message || isLoading) && (
        <div className="copilotKitMessage copilotKitAssistantMessage">
          {message && <Markdown content={message || ""} />}
          {isLoading && icons.spinnerIcon}
        </div>
      )}
      <div style={{ marginBottom: "0.5rem" }}>{subComponent}</div>
    </>
  );
};
