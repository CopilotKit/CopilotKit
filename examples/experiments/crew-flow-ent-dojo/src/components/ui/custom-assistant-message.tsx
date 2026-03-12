import {
  AssistantMessageProps,
  Markdown,
  useChatContext,
} from "@copilotkit/react-ui";

export const CustomAssistantMessage = ({
  message,
  isLoading,
  subComponent,
}: AssistantMessageProps) => {
  const { icons } = useChatContext();
  const response = (() => {
    try {
      return JSON.parse(message || "").response;
    } catch {
      return message;
    }
  })();

  return (
    <div className="py-2">
      <div className="flex items-start">
        <div className="px-4 rounded-xl pt-2">
          {response && <Markdown content={response || ""} />}
          {isLoading && icons.spinnerIcon}
        </div>
      </div>
      <div className="my-2">{subComponent}</div>
    </div>
  );
};
