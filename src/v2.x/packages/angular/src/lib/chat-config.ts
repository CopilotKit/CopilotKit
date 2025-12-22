import { inject, InjectionToken, Provider } from "@angular/core";

// Type for chat labels
export interface CopilotChatLabels {
  chatInputPlaceholder: string;
  chatInputToolbarStartTranscribeButtonLabel: string;
  chatInputToolbarCancelTranscribeButtonLabel: string;
  chatInputToolbarFinishTranscribeButtonLabel: string;
  chatInputToolbarAddButtonLabel: string;
  chatInputToolbarToolsButtonLabel: string;
  assistantMessageToolbarCopyCodeLabel: string;
  assistantMessageToolbarCopyCodeCopiedLabel: string;
  assistantMessageToolbarCopyMessageLabel: string;
  assistantMessageToolbarThumbsUpLabel: string;
  assistantMessageToolbarThumbsDownLabel: string;
  assistantMessageToolbarReadAloudLabel: string;
  assistantMessageToolbarRegenerateLabel: string;
  userMessageToolbarCopyMessageLabel: string;
  userMessageToolbarEditMessageLabel: string;
  chatDisclaimerText: string;
}

// Default labels constant
export const COPILOT_CHAT_DEFAULT_LABELS: CopilotChatLabels = {
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
};

export const COPILOT_CHAT_LABELS = new InjectionToken<CopilotChatLabels>(
  "COPILOT_CHAT_LABELS"
);

export function injectChatLabels(): CopilotChatLabels {
  return (
    inject(COPILOT_CHAT_LABELS, { optional: true }) ??
    COPILOT_CHAT_DEFAULT_LABELS
  );
}

export function provideCopilotChatLabels(
  config: Partial<CopilotChatLabels>
): Provider {
  return {
    provide: COPILOT_CHAT_LABELS,
    useValue: {
      ...COPILOT_CHAT_DEFAULT_LABELS,
      ...config,
    },
  };
}
