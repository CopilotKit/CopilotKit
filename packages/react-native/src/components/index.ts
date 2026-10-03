/**
 * Component barrel — importable via `@copilotkit/react-native/components`.
 */

export { CopilotChat } from "./CopilotChat";
export type { CopilotChatProps } from "./CopilotChat";

export { CopilotModal } from "./CopilotModal";
export type { CopilotModalProps, CopilotModalRef } from "./CopilotModal";

export {
  CopilotMarkdown,
  darkMarkdownStyles,
  defaultMarkdownStyles,
} from "./Markdown";
export type { CopilotMarkdownProps } from "./Markdown";

export { CopilotColorSchemeProvider } from "./theme";
export type { CopilotColorScheme } from "./theme";

export { AssistantMessage } from "./messages/AssistantMessage";
export type { AssistantMessageProps } from "./messages/AssistantMessage";

export { UserMessage } from "./messages/UserMessage";
export type { UserMessageProps } from "./messages/UserMessage";
