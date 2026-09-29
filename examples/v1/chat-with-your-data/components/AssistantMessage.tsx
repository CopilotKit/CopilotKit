import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessageProps } from "@copilotkit/react-core/v2";

function CustomAssistantMessageComponent(
  props: CopilotChatAssistantMessageProps,
) {
  return (
    <CopilotChatAssistantMessage
      {...props}
      className="rounded-lg border border-gray-200 bg-white p-4 pb-4 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
    />
  );
}

export const CustomAssistantMessage =
  CustomAssistantMessageComponent as typeof CopilotChatAssistantMessage;
