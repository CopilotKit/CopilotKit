// TODO(copilotkit-2.0): `AssistantMessage` was removed in 2.0. Use `CopilotChatAssistantMessage` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/components/CopilotChatAssistantMessage
// TODO(copilotkit-2.0): `UserMessage` was removed in 2.0. Use `CopilotChatUserMessage` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/components/CopilotChatUserMessage
import { AssistantMessage, UserMessage } from "@copilotkit/react-ui";

export function MyAssistantMessage(props: { message: string }) {
  return <AssistantMessage {...props} />;
}

export function MyUserMessage(props: { message: string }) {
  return <UserMessage {...props} />;
}
