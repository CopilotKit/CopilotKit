import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import type {
  CopilotKitCoreErrorCode,
  ToolCallStatus,
} from "@copilotkitnext/core";
import type { CopilotChatLabels } from "../../providers/types";
import type { InterruptEvent } from "../../types";

export type CopilotChatInputMode = "input" | "transcribe" | "processing";

export interface CopilotChatViewProps {
  messages?: Message[];
  autoScroll?: boolean;
  isRunning?: boolean;
  suggestions?: import("@copilotkitnext/core").Suggestion[];
  suggestionLoadingIndexes?: ReadonlyArray<number>;
  welcomeScreen?: boolean;
  inputValue?: string;
  inputMode?: CopilotChatInputMode;
  inputToolsMenu?: (ToolsMenuItem | "-")[];
  onFinishTranscribeWithAudio?: (audioBlob: Blob) => void | Promise<void>;
}

export interface CopilotChatProps extends Omit<
  CopilotChatViewProps,
  "messages" | "isRunning" | "suggestions" | "suggestionLoadingIndexes"
> {
  agentId?: string;
  threadId?: string;
  labels?: Partial<CopilotChatLabels>;
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
    suggestion: import("@copilotkitnext/core").Suggestion,
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

export interface CopilotChatInterruptSlotProps<TValue = unknown, TResult = unknown> {
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
  onStop: () => void;
  onAddFile: () => void;
  onStartTranscribe: () => void;
  onCancelTranscribe: () => void;
  onFinishTranscribe: () => void;
  onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
}

export interface CopilotChatSuggestionViewSlotProps {
  suggestions: import("@copilotkitnext/core").Suggestion[];
  loadingIndexes: ReadonlyArray<number>;
  onSelectSuggestion: (
    suggestion: import("@copilotkitnext/core").Suggestion,
    index: number,
  ) => void;
}

export interface CopilotChatWelcomeScreenSlotProps extends CopilotChatSuggestionViewSlotProps {
  modelValue: string;
  isRunning: boolean;
  inputMode: CopilotChatInputMode;
  inputToolsMenu: (ToolsMenuItem | "-")[];
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
  onStop: () => void;
  onAddFile?: () => void;
  onStartTranscribe?: () => void;
  onCancelTranscribe?: () => void;
  onFinishTranscribe?: () => void;
  onFinishTranscribeWithAudio?: (audioBlob: Blob) => void | Promise<void>;
}

export interface CopilotSidebarWelcomeScreenSuggestionViewSlotProps {
  suggestions: import("@copilotkitnext/core").Suggestion[];
  loadingIndexes: ReadonlyArray<number>;
  onSelectSuggestion: (
    suggestion: import("@copilotkitnext/core").Suggestion,
    index: number,
  ) => void;
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
