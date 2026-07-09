import type {
  Message,
  AssistantMessage,
  UserMessage,
  ReasoningMessage,
  ToolCall,
  ToolMessage,
} from "@ag-ui/core";
import type { ToolCallStatus } from "@copilotkit/core";
import type { Suggestion } from "@copilotkit/core";
import type {
  Attachment,
  AttachmentModality,
  InputContent,
} from "@copilotkit/shared";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";

export type { Attachment, AttachmentModality, InputContent };

export type AutoScrollMode = "pin-to-bottom" | "pin-to-send" | "none";

export function normalizeAutoScroll(
  value: AutoScrollMode | boolean | undefined,
): AutoScrollMode {
  if (value === undefined || value === true) return "pin-to-bottom";
  if (value === false) return "none";
  return value;
}

export type CopilotChatInputMode = "input" | "transcribe" | "processing";

export type ToolsMenuItem = {
  label: string;
} & (
  | { action: () => void; items?: never }
  | { action?: never; items: (ToolsMenuItem | "-")[] }
);

export interface CopilotChatProps {
  agentId?: string;
  threadId?: string;
  throttleMs?: number;
  labels?: Record<string, string>;
  className?: string;
  autoScroll?: AutoScrollMode | boolean;
  welcomeScreen?: boolean;
  inputValue?: string;
  inputMode?: CopilotChatInputMode;
  inputToolsMenu?: (ToolsMenuItem | "-")[];
  attachments?: boolean | { accept?: string };
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, unknown>;
  }) => void;
}

export interface CopilotChatViewProps {
  messages: Message[];
  isRunning: boolean;
  autoScroll?: AutoScrollMode | boolean;
  welcomeScreen?: boolean;
  suggestions?: Suggestion[];
  attachments?: Attachment[];
  inputValue?: string;
  inputMode?: CopilotChatInputMode;
  inputToolsMenu?: (ToolsMenuItem | "-")[];
  isConnecting?: boolean;
  hasExplicitThreadId?: boolean;
  onSubmitMessage: (value: string) => void;
  onStop?: () => void;
  onInputChange: (value: string) => void;
  onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
  onRemoveAttachment?: (id: string) => void;
  onAddFile?: () => void;
}

export interface CopilotSidebarProps extends CopilotChatProps {
  width?: number | string;
  defaultOpen?: boolean;
}

export interface CopilotPopupProps extends CopilotChatProps {
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  defaultOpen?: boolean;
}

export interface CopilotChatToggleButtonProps {
  isOpen: boolean;
  onclick?: () => void;
}

export interface CopilotChatToolCallRenderSlotProps {
  name: string;
  args: unknown;
  status: ToolCallStatus;
  result: string | undefined;
  toolCall: ToolCall;
  toolMessage: ToolMessage | undefined;
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
