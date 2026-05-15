export const CopilotChatDefaultLabels = {
  chatInputPlaceholder: "Type a message...",
  chatInputToolbarStartTranscribeButtonLabel: "Transcribe",
  chatInputToolbarCancelTranscribeButtonLabel: "Cancel",
  chatInputToolbarFinishTranscribeButtonLabel: "Finish",
  chatInputToolbarAddButtonLabel: "Add photos or files",
  chatInputToolbarToolsButtonLabel: "Tools",
  assistantMessageToolbarCopyCodeLabel: "Copy",
  assistantMessageToolbarCopyCodeCopiedLabel: "Copied",
  assistantMessageToolbarCopyMessageLabel: "Copy",
  assistantMessageToolbarThumbsUpLabel: "Good response",
  assistantMessageToolbarThumbsDownLabel: "Bad response",
  assistantMessageToolbarReadAloudLabel: "Read aloud",
  assistantMessageToolbarRegenerateLabel: "Regenerate",
  userMessageToolbarCopyMessageLabel: "Copy",
  userMessageToolbarEditMessageLabel: "Edit",
  chatDisclaimerText:
    "AI can make mistakes. Please verify important information.",
  chatToggleOpenLabel: "Open chat",
  chatToggleCloseLabel: "Close chat",
  modalHeaderTitle: "CopilotKit Chat",
  welcomeMessageText: "How can I help you today?",
} as const;

export type CopilotChatLabels = typeof CopilotChatDefaultLabels;

export interface CopilotChatConfigurationValue {
  labels: CopilotChatLabels;
  agentId: string;
  threadId: string;
  /**
   * True when the current `threadId` was chosen by the caller rather than
   * silently minted inside the provider chain. Consumers that only make
   * sense against a real backend thread (e.g. `/connect`, suppressing the
   * welcome screen on switch) gate on this instead of `!!threadId`.
   */
  hasExplicitThreadId: boolean;
  isModalOpen?: boolean;
  setModalOpen?: (open: boolean) => void;
}
