import type {
  AssistantMessage,
  Message,
  ReasoningMessage,
  ToolCall,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import type { CopilotKitCoreErrorCode, ToolCallStatus } from "@copilotkit/core";
import type { Suggestion } from "@copilotkit/core";
import type {
  Attachment,
  AttachmentsConfig,
  AttachmentModality,
} from "@copilotkit/shared";
import type { CopilotChatLabels } from "../../providers/types";
import type { InterruptEvent } from "../../types";
import type { AutoScrollMode } from "./normalize-auto-scroll";

export type CopilotChatInputMode = "input" | "transcribe" | "processing";
export type { Attachment, AttachmentsConfig, AttachmentModality };
export type { AutoScrollMode };

export interface CopilotChatAttachmentRendererProps {
  type: AttachmentModality;
  source: Attachment["source"];
  filename?: string;
  className?: string;
}

export interface CopilotChatAttachmentQueueProps {
  attachments: Attachment[];
  className?: string;
}

export interface CopilotChatViewProps {
  messages?: Message[];
  /**
   * Controls how the chat view scrolls as new messages stream in.
   *
   * Accepts the modern `AutoScrollMode` strings or the legacy boolean
   * shorthand. Defaults to `"pin-to-bottom"` when unspecified.
   *
   * - `"pin-to-bottom"` / `true`: stick to the bottom while at the bottom.
   * - `"pin-to-send"`: anchor the latest user message near the top of
   *   the viewport while the assistant streams a response (parity with
   *   React's `usePinToSend`).
   * - `"none"` / `false`: never auto-scroll.
   */
  autoScroll?: AutoScrollMode | boolean;
  isRunning?: boolean;
  suggestions?: Suggestion[];
  suggestionLoadingIndexes?: ReadonlyArray<number>;
  welcomeScreen?: boolean;
  attachments?: Attachment[];
  dragOver?: boolean;
  inputValue?: string;
  inputMode?: CopilotChatInputMode;
  inputToolsMenu?: (ToolsMenuItem | "-")[];
  /**
   * When `true`, suppresses the welcome screen while a thread's initial
   * connect is in flight. Prevents the "How can I help you today?" flash
   * that would otherwise appear between mounting an empty cloned agent and
   * the bootstrap messages arriving from `/connect`.
   */
  isConnecting?: boolean;
  /**
   * When `true`, the caller has explicitly picked a thread (via `threadId`
   * prop or `CopilotChatConfigurationProvider`). Suppresses the welcome
   * screen unconditionally — a caller-managed thread targets a specific
   * conversation and should render its messages (or an empty panel during
   * connect) rather than a generic "start a new chat" greeting.
   */
  hasExplicitThreadId?: boolean;
  onRemoveAttachment?: (id: string) => void;
  onAddFile?: () => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
  onFinishTranscribeWithAudio?: (audioBlob: Blob) => void | Promise<void>;
}

export interface CopilotChatProps extends Omit<
  CopilotChatViewProps,
  | "messages"
  | "isRunning"
  | "suggestions"
  | "suggestionLoadingIndexes"
  | "attachments"
  | "onRemoveAttachment"
  | "onAddFile"
  | "dragOver"
  | "onDragOver"
  | "onDragLeave"
  | "onDrop"
> {
  agentId?: string;
  threadId?: string;
  throttleMs?: number;
  labels?: Partial<CopilotChatLabels>;
  attachments?: AttachmentsConfig;
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;
}

export interface CopilotChatViewOverrideSlotProps extends CopilotChatViewProps {
  onSubmitMessage: (value: string) => void | Promise<void>;
  onStop?: () => void;
  onInputChange: (value: string) => void;
  onSelectSuggestion: (
    suggestion: Suggestion,
    index: number,
  ) => void | Promise<void>;
  onAddFile?: () => void;
  onStartTranscribe?: () => void;
  onCancelTranscribe?: () => void;
  onFinishTranscribe?: () => void;
  onFinishTranscribeWithAudio?: (audioBlob: Blob) => void | Promise<void>;
}

export interface CopilotChatMessageViewSlotProps {
  messages: Message[];
  isRunning: boolean;
}

export interface CopilotChatScrollToBottomButtonSlotProps {
  onClick: () => void;
}

export interface CopilotChatFeatherSlotProps {}

export interface CopilotChatScrollViewSlotProps
  extends CopilotChatMessageViewSlotProps, CopilotChatSuggestionViewSlotProps {
  messagePaddingBottom: string;
  showScrollToBottomButton: boolean;
  onScroll: () => void;
  scrollToBottom: () => void;
}

export interface CopilotChatInterruptSlotProps<
  TValue = unknown,
  TResult = unknown,
> {
  event: InterruptEvent<TValue>;
  result: TResult;
  resolve: (response: unknown) => void;
}

export interface CopilotChatInputSlotProps {
  modelValue: string;
  isRunning: boolean;
  inputMode: CopilotChatInputMode;
  inputToolsMenu: (ToolsMenuItem | "-")[];
  onUpdateModelValue: (value: string) => void;
  onSubmitMessage: (value: string) => void;
  onStop?: () => void;
  onAddFile: () => void;
  onStartTranscribe: () => void;
  onCancelTranscribe: () => void;
  onFinishTranscribe: () => void;
  onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
}

export interface CopilotChatSuggestionViewSlotProps {
  suggestions: Suggestion[];
  loadingIndexes: ReadonlyArray<number>;
  onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
}

export interface CopilotChatSuggestionViewSuggestionSlotProps {
  suggestion: Suggestion;
  index: number;
  isLoading: boolean;
  onSelect: () => void;
}

export interface CopilotChatSuggestionViewContainerSlotProps extends CopilotChatSuggestionViewSlotProps {
  containerClass: unknown[];
  containerAttrs: Record<string, unknown>;
}

export interface CopilotChatSuggestionViewLayoutSlotProps extends CopilotChatSuggestionViewContainerSlotProps {}

export interface CopilotChatWelcomeScreenSlotProps extends CopilotChatSuggestionViewSlotProps {
  modelValue: string;
  isRunning: boolean;
  inputMode: CopilotChatInputMode;
  inputToolsMenu: (ToolsMenuItem | "-")[];
  onUpdateModelValue: (value: string) => void;
  onSubmitMessage: (value: string) => void;
  onStop?: () => void;
  onAddFile: () => void;
  onStartTranscribe: () => void;
  onCancelTranscribe: () => void;
  onFinishTranscribe: () => void;
  onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
}

export type ToolsMenuItem = {
  label: string;
} & (
  | {
      action: () => void;
      items?: never;
    }
  | {
      action?: never;
      items: (ToolsMenuItem | "-")[];
    }
);

export interface CopilotChatUserMessageOnEditMessageProps {
  message: UserMessage;
}

export interface CopilotChatUserMessageOnSwitchToBranchProps {
  message: UserMessage;
  branchIndex: number;
  numberOfBranches: number;
}

export interface CopilotChatUserMessageMessageRendererSlotProps {
  message: UserMessage;
  content: string;
  isMultiline: boolean;
}

export interface CopilotChatUserMessageToolbarSlotProps {
  message: UserMessage;
  showBranchNavigation: boolean;
  hasEditAction: boolean;
}

export interface CopilotChatUserMessageCopyButtonSlotProps {
  onCopy: () => Promise<void>;
  copied: boolean;
  label: string;
}

export interface CopilotChatUserMessageEditButtonSlotProps {
  onEdit: () => void;
  label: string;
}

export interface CopilotChatUserMessageBranchNavigationSlotProps {
  branchIndex: number;
  numberOfBranches: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  goPrev: () => void;
  goNext: () => void;
}

export interface CopilotChatUserMessageLayoutSlotProps {
  message: UserMessage;
  content: string;
  isMultiline: boolean;
  showBranchNavigation: boolean;
  hasEditAction: boolean;
  branchIndex: number;
  numberOfBranches: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onCopy: () => Promise<void>;
  onEdit: () => void;
  goPrev: () => void;
  goNext: () => void;
  copied: boolean;
}

export interface CopilotChatAssistantMessageMessageRendererSlotProps {
  message: AssistantMessage;
  content: string;
}

export interface CopilotChatAssistantMessageToolbarSlotProps {
  message: AssistantMessage;
  shouldShowToolbar: boolean;
}

export interface CopilotChatAssistantMessageCopyButtonSlotProps {
  onCopy: () => Promise<void>;
  copied: boolean;
  label: string;
}

export interface CopilotChatAssistantMessageThumbsUpButtonSlotProps {
  onThumbsUp: () => void;
  label: string;
}

export interface CopilotChatAssistantMessageThumbsDownButtonSlotProps {
  onThumbsDown: () => void;
  label: string;
}

export interface CopilotChatAssistantMessageReadAloudButtonSlotProps {
  onReadAloud: () => void;
  label: string;
}

export interface CopilotChatAssistantMessageRegenerateButtonSlotProps {
  onRegenerate: () => void;
  label: string;
}

export interface CopilotChatAssistantMessageToolCallsViewSlotProps {
  message: AssistantMessage;
  messages: Message[];
}

export interface CopilotChatAssistantMessageLayoutSlotProps {
  message: AssistantMessage;
  content: string;
  isRunning: boolean;
  toolbarVisible: boolean;
  shouldShowToolbar: boolean;
  messageRenderer: unknown;
  toolbar: unknown;
  copyButton: unknown;
  thumbsUpButton: unknown;
  thumbsDownButton: unknown;
  readAloudButton: unknown;
  regenerateButton: unknown;
  toolCallsView: unknown;
  onCopy: () => Promise<void>;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onReadAloud: () => void;
  onRegenerate: () => void;
}

export interface CopilotChatReasoningMessageHeaderSlotProps {
  isOpen: boolean;
  label: string;
  hasContent: boolean;
  isStreaming: boolean;
  onClick?: () => void;
}

export interface CopilotChatReasoningMessageContentViewSlotProps {
  isStreaming: boolean;
  hasContent: boolean;
  content: string;
}

export interface CopilotChatReasoningMessageToggleSlotProps {
  isOpen: boolean;
  contentView: CopilotChatReasoningMessageContentViewSlotProps;
}

export interface CopilotChatReasoningMessageLayoutSlotProps {
  message: ReasoningMessage;
  messages: Message[];
  isRunning: boolean;
  header: CopilotChatReasoningMessageHeaderSlotProps;
  contentView: CopilotChatReasoningMessageContentViewSlotProps;
  toggle: CopilotChatReasoningMessageToggleSlotProps;
}

export interface CopilotChatToolCallRenderSlotProps {
  name: string;
  args: unknown;
  status: ToolCallStatus;
  result: string | undefined;
  toolCall: ToolCall;
  toolMessage: ToolMessage | undefined;
}

export interface CopilotChatToggleButtonProps {
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export interface CopilotChatToggleButtonIconSlotProps {
  iconClass: string;
  isOpen: boolean;
}

export interface CopilotModalHeaderProps {
  title?: string;
}

export interface CopilotModalHeaderTitleContentSlotProps {
  title: string;
}

export interface CopilotModalHeaderCloseButtonSlotProps {
  onClose: () => void;
}

export interface CopilotModalHeaderLayoutSlotProps {
  title: string;
  onClose: () => void;
}

export interface CopilotSidebarWelcomeScreenInputSlotProps {
  modelValue: string;
  isRunning: boolean;
  inputMode: CopilotChatInputMode;
  inputToolsMenu: (ToolsMenuItem | "-")[];
  onUpdateModelValue: (value: string) => void;
  onSubmitMessage: (value: string) => void;
  onStop?: () => void;
  onAddFile?: () => void;
  onStartTranscribe?: () => void;
  onCancelTranscribe?: () => void;
  onFinishTranscribe?: () => void;
  onFinishTranscribeWithAudio?: (audioBlob: Blob) => void | Promise<void>;
}

export interface CopilotSidebarWelcomeScreenSuggestionViewSlotProps {
  suggestions: Suggestion[];
  loadingIndexes: ReadonlyArray<number>;
  onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
}

export interface CopilotSidebarWelcomeScreenLayoutSlotProps
  extends
    CopilotSidebarWelcomeScreenInputSlotProps,
    CopilotSidebarWelcomeScreenSuggestionViewSlotProps {}

export type CopilotSidebarWelcomeScreenProps =
  CopilotSidebarWelcomeScreenLayoutSlotProps;

export interface CopilotSidebarViewHeaderSlotProps {
  title: string;
  onClose: () => void;
  isOpen: boolean;
}

export interface CopilotSidebarViewToggleButtonSlotProps {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export interface CopilotSidebarViewProps extends CopilotChatViewProps {
  width?: number | string;
  defaultOpen?: boolean;
}

export type CopilotPopupViewHeaderSlotProps = CopilotSidebarViewHeaderSlotProps;

export type CopilotPopupViewToggleButtonSlotProps =
  CopilotSidebarViewToggleButtonSlotProps;

export type CopilotPopupWelcomeScreenInputSlotProps =
  CopilotSidebarWelcomeScreenInputSlotProps;

export type CopilotPopupWelcomeScreenSuggestionViewSlotProps =
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps;

export type CopilotPopupWelcomeScreenLayoutSlotProps =
  CopilotSidebarWelcomeScreenLayoutSlotProps;

export type CopilotPopupWelcomeScreenProps =
  CopilotPopupWelcomeScreenLayoutSlotProps;

export interface CopilotPopupViewProps extends CopilotChatViewProps {
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  defaultOpen?: boolean;
}

export interface CopilotPopupProps extends CopilotChatProps {
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  defaultOpen?: boolean;
}

export interface CopilotSidebarProps extends CopilotChatProps {
  width?: number | string;
  defaultOpen?: boolean;
}
