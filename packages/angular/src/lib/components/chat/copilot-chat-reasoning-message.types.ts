import type { ReasoningMessage } from "@ag-ui/core";

export interface ReasoningMessageHeaderContext {
  isOpen: boolean;
  label: string;
  hasContent: boolean;
  isStreaming: boolean;
  onClick?: () => void;
}

export interface ReasoningMessageContentContext {
  isStreaming: boolean;
  hasContent: boolean;
  content: string;
}

export interface ReasoningMessageToggleContext {
  isOpen: boolean;
}

export type { ReasoningMessage };
