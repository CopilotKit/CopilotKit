import { AssistantMessage, UserMessage } from "@copilotkit/react-ui";

export function MyAssistantMessage(props: { message: string }) {
  return <AssistantMessage {...props} />;
}

export function MyUserMessage(props: { message: string }) {
  return <UserMessage {...props} />;
}
