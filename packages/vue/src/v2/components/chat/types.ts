import type {
  AssistantMessage,
  Message,
  ReasoningMessage,
  ToolCall,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import type { VNode } from "vue";
import type { CopilotKitCoreErrorCode, ToolCallStatus } from "@copilotkit/core";
import type { Suggestion } from "@copilotkit/core";
import type {
  Attachment,
  AttachmentsConfig,
  AttachmentModality,
  InputContentSource,
} from "@copilotkit/shared";
import type {
  CopilotChatLabels,
  CopilotChatToolCallDisplay,
  ToolCallEntry,
} from "@copilotkit/core";
import type { InterruptEvent } from "../../types";
import type { AutoScrollMode } from "./normalize-auto-scroll";

export type CopilotChatInputMode = "input" | "transcribe" | "processing";
export type { Attachment, AttachmentsConfig, AttachmentModality };
export type { AutoScrollMode };
export type { CopilotChatToolCallDisplay, ToolCallEntry };

/** How a `CopilotChatToolCallGroup` draws its calls. */
export type CopilotChatToolCallGroupAppearance = "card" | "line" | "stack";

/** Props of the `#tool-calls-group` slot, which replaces a group of calls. */
export interface CopilotChatToolCallsGroupSlotProps {
  /** The calls in the group, in order. */
  calls: ToolCallEntry[];
  /** The appearance the view's `toolCallDisplay` asks for. */
  appearance: CopilotChatToolCallGroupAppearance;
  /** The agent is running and nothing follows the group, so more calls may join it. */
  isActive: boolean;
  /**
   * Draws one call through the registered renderers and tool-call slots.
   * Render the VNode with `<component :is="renderCall(call)" />`.
   */
  renderCall: (call: ToolCallEntry) => VNode;
}

/**
 * Props of `CopilotChatWorkSummary` and of the `#work-summary` slot, which
 * replaces the "Working… / Worked for 9s" line of the `"turn"` display.
 */
export interface CopilotChatWorkSummarySlotProps {
  /** The agent is still working on this reply. */
  isWorking: boolean;
  /** Whether the work (narration and tool calls) is showing. */
  isOpen: boolean;
  /** The tool calls the reply made. */
  calls: ToolCallEntry[];
  /**
   * How long the agent has worked on the reply, in ms, summed over its runs
   * so time spent waiting between them doesn't count. Only known for replies
   * this client watched start; without it the summary shows the tool count.
   */
  elapsedMs?: number;
  /** When the current run started (epoch ms), while the agent is working. */
  workingSince?: number;
  /** Opens or closes the reply's work. */
  onClick: () => void;
}

export interface CopilotChatAttachmentRendererProps {
  type: AttachmentModality;
  /** Any AG-UI content source, as in React; a `file` handle shows no preview. */
  source: InputContentSource;
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
  /** Optional event callbacks used to drive the default input controls. */
  onSubmitMessage?: (value: string) => void | Promise<void>;
  /**
   * Presence drives reactive gating of the default stop control.
   * Prefer `@stop` / `emit("stop")` for invocation; do not call this prop
   * directly or the handler can fire twice.
   */
  onStop?: () => void;
  onInputChange?: (value: string) => void;
  onSelectSuggestion?: (
    suggestion: Suggestion,
    index: number,
  ) => void | Promise<void>;
  onStartTranscribe?: () => void;
  onCancelTranscribe?: () => void;
  onFinishTranscribe?: () => void;
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
  /**
   * How tool calls show. Defaults to `"grouped"`: calls made in a row share
   * one card that opens to a row per call. `"line"` and `"stacked"` group
   * them too; `"separate"` gives every call its own card. Calls drawn by a
   * renderer that does not set `group: true`, or by a tool-call slot, always
   * show on their own.
   */
  toolCallDisplay?: CopilotChatToolCallDisplay;
  /**
   * Whether reply thumbs record ratings for Automatic Learning once a
   * Trajectory has started. Defaults to `true`; set `false` to keep the
   * thumbs to your own `thumbs-up` / `thumbs-down` handlers and slots.
   */
  messageFeedback?: boolean;
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
  | "onSubmitMessage"
  | "onStop"
  | "onInputChange"
  | "onSelectSuggestion"
  | "onStartTranscribe"
  | "onCancelTranscribe"
  | "onFinishTranscribe"
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
  canStop: boolean;
  canAddFile: boolean;
  canTranscribe: boolean;
  onSubmitMessage: (value: string) => void | Promise<void>;
  onStop: () => void;
  onInputChange: (value: string) => void;
  onSelectSuggestion: (
    suggestion: Suggestion,
    index: number,
  ) => void | Promise<void>;
  onAddFile: () => void;
  onStartTranscribe: () => void;
  onCancelTranscribe: () => void;
  onFinishTranscribe: () => void;
  onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
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
  canStop: boolean;
  canAddFile: boolean;
  canTranscribe: boolean;
  onUpdateModelValue: (value: string) => void;
  onSubmitMessage: (value: string) => void;
  onStop: () => void;
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
  canStop: boolean;
  canAddFile: boolean;
  canTranscribe: boolean;
  onUpdateModelValue: (value: string) => void;
  onSubmitMessage: (value: string) => void;
  onStop: () => void;
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

/**
 * Attributes and listeners that let a thumb record a Learning rating and open
 * its comment popover. Bind them on the thumb's `<button>` with `v-bind`;
 * they are empty while the chat records no ratings.
 */
export type CopilotChatAssistantMessageThumbProps = Record<string, unknown>;

export interface CopilotChatAssistantMessageThumbsUpButtonSlotProps {
  /**
   * Rates the reply. Pass the click event, so the comment points at the
   * clicked thumb and a keyboard click moves focus into it.
   */
  onThumbsUp: (event?: MouseEvent) => void;
  label: string;
  /** This rating is the chosen one (Learning only). */
  pressed: boolean;
  thumbProps: CopilotChatAssistantMessageThumbProps;
}

export interface CopilotChatAssistantMessageThumbsDownButtonSlotProps {
  /** See {@link CopilotChatAssistantMessageThumbsUpButtonSlotProps.onThumbsUp}. */
  onThumbsDown: (event?: MouseEvent) => void;
  label: string;
  /** This rating is the chosen one (Learning only). */
  pressed: boolean;
  thumbProps: CopilotChatAssistantMessageThumbProps;
}

/** Props of the `feedback-comment` slot: the comment field of a rating. */
export interface CopilotChatAssistantMessageFeedbackCommentSlotProps {
  value: string;
  /** The comment already saved. */
  savedComment: string;
  /** Bind as `:ref` on the text field, so a keyboard rating can focus it. */
  inputRef: (element: unknown) => void;
  onChange: (value: string) => void;
  /** Saves the comment, closes the popover and returns focus to the thumb. */
  onSubmit: () => void;
  onEditingChange: (editing: boolean) => void;
  /**
   * Focus left the form for `next`, or for no focusable element when null.
   * Not called when the window loses focus.
   */
  onLeave: (next: Element | null) => void;
}

/** Props of the `inspector-button` slot. */
export interface CopilotChatAssistantMessageInspectorButtonSlotProps {
  /** Opens this message in the Inspector. */
  onInspect: () => void;
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
  canStop: boolean;
  canAddFile: boolean;
  canTranscribe: boolean;
  onUpdateModelValue: (value: string) => void;
  onSubmitMessage: (value: string) => void;
  onStop: () => void;
  onAddFile: () => void;
  onStartTranscribe: () => void;
  onCancelTranscribe: () => void;
  onFinishTranscribe: () => void;
  onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
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

type WelcomeScreenCommandProps =
  | "onStop"
  | "onAddFile"
  | "onStartTranscribe"
  | "onCancelTranscribe"
  | "onFinishTranscribe"
  | "onFinishTranscribeWithAudio";

type WelcomeScreenDerivedCapabilityProps =
  | "canStop"
  | "canAddFile"
  | "canTranscribe";

export type CopilotSidebarWelcomeScreenProps = Omit<
  CopilotSidebarWelcomeScreenLayoutSlotProps,
  WelcomeScreenCommandProps | WelcomeScreenDerivedCapabilityProps
> &
  Partial<
    Pick<
      CopilotSidebarWelcomeScreenLayoutSlotProps,
      WelcomeScreenCommandProps | WelcomeScreenDerivedCapabilityProps
    >
  >;

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
  /** The edge the sidebar docks to. Defaults to `"right"`. */
  position?: "left" | "right";
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

export type CopilotPopupWelcomeScreenProps = CopilotSidebarWelcomeScreenProps;

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
  /** The edge the sidebar docks to. Defaults to `"right"`. */
  position?: CopilotSidebarViewProps["position"];
}
