export const CopilotChatDefaultLabels = {
  chatInputPlaceholder: "Type a message...",
  chatInputToolbarStartTranscribeButtonLabel: "Transcribe",
  chatInputToolbarCancelTranscribeButtonLabel: "Cancel",
  chatInputToolbarFinishTranscribeButtonLabel: "Finish",
  chatInputToolbarAddButtonLabel: "Add photos or files",
  chatInputToolbarToolsButtonLabel: "Tools",
  chatInputToolbarSendButtonLabel: "Send message",
  chatInputToolbarStopButtonLabel: "Stop",
  assistantMessageToolbarCopyCodeLabel: "Copy",
  assistantMessageToolbarCopyCodeCopiedLabel: "Copied",
  assistantMessageToolbarCopyMessageLabel: "Copy",
  assistantMessageToolbarInspectorLabel: "View in Inspector",
  assistantMessageToolbarInspectorDescription:
    "Open this message in the Inspector",
  assistantMessageToolbarInspectorLocalOnlyLabel: "Local only",
  assistantMessageToolbarInspectorLocalOnlyDescription:
    "Only visible on localhost or loopback hosts in development. Never shown in production.",
  assistantMessageToolbarInspectorTitle: "CopilotKit Inspector",
  assistantMessageToolbarInspectorHideLabel: "Hide this icon",
  assistantMessageToolbarInspectorHideDescription: "Until you reload this page",
  assistantMessageToolbarThumbsUpLabel: "Good response",
  assistantMessageToolbarThumbsDownLabel: "Bad response",
  assistantMessageFeedbackCommentPlaceholder: "Add a comment (optional)",
  assistantMessageFeedbackCommentSubmitLabel: "Send comment",
  assistantMessageToolbarReadAloudLabel: "Read aloud",
  assistantMessageToolbarRegenerateLabel: "Regenerate",
  userMessageToolbarCopyMessageLabel: "Copy",
  userMessageToolbarEditMessageLabel: "Edit",
  userMessageToolbarPreviousBranchLabel: "Previous branch",
  userMessageToolbarNextBranchLabel: "Next branch",
  chatDisclaimerText:
    "AI can make mistakes. Please verify important information.",
  chatToggleOpenLabel: "Open chat",
  chatToggleCloseLabel: "Close chat",
  chatScrollToBottomLabel: "Scroll to bottom",
  modalHeaderTitle: "CopilotKit Chat",
  welcomeMessageText: "How can I help you today?",
  reasoningMessageThinkingLabel: "Thinking…",
  chatInputSlashMenuLabel: "Slash commands",
  chatInputSlashMenuEmptyText: "No commands found",
  attachmentRemoveButtonLabel: "Remove attachment",
  attachmentPlayVideoButtonLabel: "Play video",
  attachmentPreviewCloseButtonLabel: "Close preview",
  modalHeaderCloseButtonLabel: "Close",
  modalHeaderThreadsButtonLabel: "Open threads",
  sidebarLabel: "Copilot chat sidebar",
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
  /**
   * Switches the active thread to `threadId`. `explicit` (default `true`)
   * marks it a caller-driven choice so the welcome screen is suppressed.
   * No-op when the provider's `threadId` prop is caller-authoritative.
   */
  setActiveThreadId: (
    threadId: string,
    options?: { explicit?: boolean },
  ) => void;
  /**
   * Switches to a freshly-minted, non-explicit thread (welcome screen shows).
   * No-op when the provider's `threadId` prop is caller-authoritative.
   */
  startNewThread: () => void;
  /** Whether the mobile off-canvas drawer overlay is open. */
  drawerOpen: boolean;
  /**
   * Toggles the drawer. On mobile (`<=767px`) opening the drawer closes the
   * chat modal (mutual-exclusion). Desktop imposes no constraint.
   */
  setDrawerOpen: (open: boolean) => void;
  /** True when at least one drawer has registered (gates the header launcher). */
  drawerRegistered: boolean;
  /** Announces drawer presence; returns a cleanup that de-registers it. */
  registerDrawer: () => () => void;
}
