/**
 * Component barrel — importable via `@copilotkit/react-native/components`.
 */

// Auto-install polyfills before anything else loads: an app can import this
// entry before the root one, and @copilotkit/core and @ag-ui/client fail at
// load time on Hermes without them (scripts/verify-polyfill-barrel.mjs checks
// that this stays the built entry's first statement).
import "../polyfills";

export { CopilotChat } from "./CopilotChat";
export type { CopilotChatProps } from "./CopilotChat";

export { CopilotModal } from "./CopilotModal";
export type { CopilotModalProps, CopilotModalRef } from "./CopilotModal";

export { CopilotMarkdown, defaultMarkdownStyles } from "./Markdown";
export type { CopilotMarkdownProps } from "./Markdown";

export { AssistantMessage } from "./messages/AssistantMessage";
export type { AssistantMessageProps } from "./messages/AssistantMessage";

export { UserMessage } from "./messages/UserMessage";
export type { UserMessageProps } from "./messages/UserMessage";
