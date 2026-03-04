// React components for CopilotKit2

export {
  default as CopilotChatInput,
  type CopilotChatInputProps,
  type ToolsMenuItem,
} from "./chat/CopilotChatInput";

export {
  default as CopilotChatAssistantMessage,
  type CopilotChatAssistantMessageProps,
} from "./chat/CopilotChatAssistantMessage";

export {
  default as CopilotChatUserMessage,
  type CopilotChatUserMessageProps,
} from "./chat/CopilotChatUserMessage";

export {
  default as CopilotChatReasoningMessage,
  type CopilotChatReasoningMessageProps,
} from "./chat/CopilotChatReasoningMessage";

export {
  CopilotChatAudioRecorder,
  type AudioRecorderState,
  AudioRecorderError,
} from "./chat/CopilotChatAudioRecorder";

export {
  default as CopilotChatSuggestionPill,
  type CopilotChatSuggestionPillProps,
} from "./chat/CopilotChatSuggestionPill";

export {
  default as CopilotChatSuggestionView,
  type CopilotChatSuggestionViewProps,
} from "./chat/CopilotChatSuggestionView";

export {
  default as CopilotChatMessageView,
  type CopilotChatMessageViewProps,
} from "./chat/CopilotChatMessageView";

export {
  default as CopilotChatToolCallsView,
  type CopilotChatToolCallsViewProps,
} from "./chat/CopilotChatToolCallsView";

export {
  default as CopilotChatView,
  type CopilotChatViewProps,
} from "./chat/CopilotChatView";

export { CopilotChat, type CopilotChatProps } from "./chat/CopilotChat";

export {
  CopilotChatToggleButton,
  type CopilotChatToggleButtonProps,
  CopilotChatToggleButtonOpenIcon,
  CopilotChatToggleButtonCloseIcon,
} from "./chat/CopilotChatToggleButton";

export {
  CopilotSidebarView,
  type CopilotSidebarViewProps,
} from "./chat/CopilotSidebarView";

export {
  CopilotPopupView,
  type CopilotPopupViewProps,
} from "./chat/CopilotPopupView";

export {
  CopilotModalHeader,
  type CopilotModalHeaderProps,
} from "./chat/CopilotModalHeader";

export { CopilotSidebar, type CopilotSidebarProps } from "./chat/CopilotSidebar";

export { CopilotPopup, type CopilotPopupProps } from "./chat/CopilotPopup";

export { WildcardToolCallRender } from "./WildcardToolCallRender";

export {
  CopilotKitInspector,
  type CopilotKitInspectorProps,
} from "./CopilotKitInspector";

export {
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
  MCPAppsActivityContentSchema,
  type MCPAppsActivityContent,
} from "./MCPAppsActivityRenderer";
