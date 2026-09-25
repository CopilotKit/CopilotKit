export {
  default as CopilotChatInput,
  type CopilotChatInputProps,
  type ToolsMenuItem,
} from "./CopilotChatInput";

export {
  default as CopilotChatAssistantMessage,
  type CopilotChatAssistantMessageProps,
  type CopilotChatFeedbackMessage,
} from "./CopilotChatAssistantMessage";

export {
  default as CopilotChatUserMessage,
  type CopilotChatUserMessageProps,
} from "./CopilotChatUserMessage";

export {
  default as CopilotChatReasoningMessage,
  type CopilotChatReasoningMessageProps,
} from "./CopilotChatReasoningMessage";

export {
  CopilotChatAudioRecorder,
  type AudioRecorderState,
  AudioRecorderError,
} from "./CopilotChatAudioRecorder";

export {
  default as CopilotChatSuggestionPill,
  type CopilotChatSuggestionPillProps,
} from "./CopilotChatSuggestionPill";

export {
  default as CopilotChatSuggestionView,
  type CopilotChatSuggestionViewProps,
} from "./CopilotChatSuggestionView";

export {
  default as CopilotChatMessageView,
  type CopilotChatMessageViewProps,
} from "./CopilotChatMessageView";

export {
  default as CopilotChatToolCallsView,
  type CopilotChatToolCallsViewProps,
} from "./CopilotChatToolCallsView";

export {
  default as CopilotChatView,
  type CopilotChatViewProps,
} from "./CopilotChatView";

export { CopilotChat, type CopilotChatProps } from "./CopilotChat";

export {
  CopilotChatApproval,
  type CopilotChatApprovalProps,
} from "./CopilotChatApproval";
export {
  CopilotChatNotice,
  type CopilotChatNoticeProps,
} from "./CopilotChatNotice";
export {
  CopilotChatAutopilotActivity,
  type CopilotChatAutopilotActivityProps,
} from "./CopilotChatAutopilotActivity";
export {
  CopilotToolApprovalCard,
  type CopilotToolApprovalCardProps,
} from "./CopilotToolApprovalCard";
export {
  CopilotApprovalController,
  useCopilotApproval,
  useCopilotApprovalWork,
  type CopilotApprovalRequest,
  type CopilotApprovalDecision,
  type CopilotApprovalResponse,
  type CopilotApprovalStore,
} from "../../hooks/use-copilot-approval";

export {
  CopilotChatToggleButton,
  type CopilotChatToggleButtonProps,
  CopilotChatToggleButtonOpenIcon,
  CopilotChatToggleButtonCloseIcon,
} from "./CopilotChatToggleButton";

export {
  CopilotSidebarView,
  type CopilotSidebarViewProps,
} from "./CopilotSidebarView";

export {
  CopilotPopupView,
  type CopilotPopupViewProps,
} from "./CopilotPopupView";

export {
  CopilotModalHeader,
  type CopilotModalHeaderProps,
} from "./CopilotModalHeader";

export { CopilotSidebar, type CopilotSidebarProps } from "./CopilotSidebar";

export { CopilotPopup, type CopilotPopupProps } from "./CopilotPopup";

export {
  CopilotThreadsDrawer,
  type CopilotThreadsDrawerProps,
  type CopilotThreadsDrawerRowRenderer,
} from "./CopilotThreadsDrawer";

export { CopilotChatAttachmentQueue } from "./CopilotChatAttachmentQueue";
export { CopilotChatAttachmentRenderer } from "./CopilotChatAttachmentRenderer";

export type {
  Attachment,
  AttachmentsConfig,
  AttachmentModality,
} from "@copilotkit/shared";

export type { AutoScrollMode } from "./normalize-auto-scroll";
