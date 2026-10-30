/**
 * The default English text for every word the chat UI shows. React, Vue and
 * Angular all read their chat text from this one set.
 *
 * To change or translate the text, pass a partial set to your framework's chat
 * configuration. Keys you leave out keep their default:
 *
 * ```ts
 * const labels = { ...CopilotChatDefaultLabels, chatInputPlaceholder: "Ask me" };
 * ```
 *
 * Some values are templates with `{name}` placeholders, such as
 * `"Thought for {duration}"`. Keep the placeholders when you translate them.
 *
 * Counts use two keys: `...One` for a count of 1, and `...Other` for any other
 * count.
 */
export const CopilotChatDefaultLabels = Object.freeze({
  chatInputPlaceholder: "Type a message...",
  chatInputToolbarStartTranscribeButtonLabel: "Transcribe",
  chatInputToolbarCancelTranscribeButtonLabel: "Cancel",
  chatInputToolbarFinishTranscribeButtonLabel: "Finish",
  chatInputToolbarAddButtonLabel: "Add attachments",
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

  /** Shown over the chat while the user drags files onto it. */
  chatDropFilesLabel: "Drop files here",
  /** Shown when a saved thread fails to load. */
  threadLoadErrorText:
    "Could not load saved conversation. Reopen the thread and try again.",

  /** Reasoning header after the model stops thinking. `{duration}` is one of the `reasoningMessageDuration...` texts. */
  reasoningMessageThoughtForLabel: "Thought for {duration}",
  /** Duration under 1 second. */
  reasoningMessageDurationFewSeconds: "a few seconds",
  /** Duration under 1 minute. `{count}`: whole seconds. */
  reasoningMessageDurationSeconds: "{count} seconds",
  /** Duration of exactly 1 minute. `{count}`: minutes. */
  reasoningMessageDurationMinutesOne: "{count} minute",
  /** Duration of whole minutes, more than 1. `{count}`: minutes. */
  reasoningMessageDurationMinutesOther: "{count} minutes",
  /** Duration of minutes plus seconds. `{minutes}`, `{seconds}`. */
  reasoningMessageDurationMinutesSeconds: "{minutes}m {seconds}s",

  /** Status of a tool call that is still running. */
  toolCallStatusRunningLabel: "Running",
  /** Status of a tool call that finished. */
  toolCallStatusDoneLabel: "Done",
  /** Status of a tool call that returned an error. */
  toolCallStatusFailedLabel: "Failed",
  /** Status of a tool call that stopped before it finished. */
  toolCallStatusStoppedLabel: "Stopped",
  /** Summary while a tool runs. `{name}`: the tool name. */
  toolCallRunningLabel: "Running {name}",
  /** Number of failed tool calls. `{count}`: the number. */
  toolCallFailedCountLabel: "{count} failed",
  /** Heading above the arguments of a tool call. */
  toolCallArgumentsLabel: "Arguments",
  /** Heading above the result of a tool call. */
  toolCallResultLabel: "Result",
  /** Button that closes an open group of tool calls. */
  toolCallCollapseLabel: "Collapse",
  /** Summary of a finished group with 1 tool call. `{count}`: the number. */
  toolCallUsedToolsOne: "Used {count} tool",
  /** Summary of a finished group with any other number of tool calls. `{count}`: the number. */
  toolCallUsedToolsOther: "Used {count} tools",
  /** Count of tools, for 1. `{count}`: the number. */
  toolCallToolCountOne: "{count} tool",
  /** Count of tools, for any other number. `{count}`: the number. */
  toolCallToolCountOther: "{count} tools",
  /** Count of tool calls, for 1. `{count}`: the number. */
  toolCallToolCallCountOne: "{count} tool call",
  /** Count of tool calls, for any other number. `{count}`: the number. */
  toolCallToolCallCountOther: "{count} tool calls",
  /** Short count of calls, for 1. `{count}`: the number. */
  toolCallCallCountOne: "{count} call",
  /** Short count of calls, for any other number. `{count}`: the number. */
  toolCallCallCountOther: "{count} calls",

  /** Work summary while the agent runs. */
  workSummaryWorkingLabel: "Working",
  /** Work summary after the run. `{duration}`: the run time. */
  workSummaryWorkedForLabel: "Worked for {duration}",

  /** Shown in place of an image attachment that fails to load. */
  attachmentImageLoadErrorText: "Failed to load image",
  /** Alt text of an image attachment. */
  attachmentImageAltText: "Image attachment",
  /** Shown when a file attachment has no name and no type. */
  attachmentUnknownTypeText: "Unknown type",

  /** Transcription error: too many requests. */
  transcriptionErrorRateLimitedText: "Too many requests. Please wait a moment.",
  /** Transcription error: the service rejected the credentials. */
  transcriptionErrorAuthFailedText:
    "Authentication error. Please check your configuration.",
  /** Transcription error: the recording is too long. */
  transcriptionErrorAudioTooLongText:
    "Recording is too long. Please try a shorter recording.",
  /** Transcription error: the recording is too short. */
  transcriptionErrorAudioTooShortText:
    "Recording is too short. Please try again.",
  /** Transcription error: the audio format is not supported. */
  transcriptionErrorInvalidAudioFormatText: "Audio format not supported.",
  /** Transcription error: no transcription service is set up. */
  transcriptionErrorServiceNotConfiguredText:
    "Transcription service is not available.",
  /** Transcription error: the network request failed. */
  transcriptionErrorNetworkText: "Network error. Please check your connection.",
  /** Transcription error that the user can retry, or an unknown error. */
  transcriptionErrorGenericText: "Transcription failed. Please try again.",

  /** License banner when no license is set. */
  licensePoweredByText: "Powered by CopilotKit",
  /** License banner link to get a license. */
  licenseGetLicenseLabel: "Get a license",
  /** License banner when a feature needs a license. `{feature}`: the feature name. */
  licenseFeatureUnlicensedText:
    '⚠ The "{feature}" feature requires a CopilotKit license.',
  /** License banner when the license expires soon and the day count is not known. */
  licenseExpiringText: "Your CopilotKit license expires soon. Please renew.",
  /** License banner when the license expires in 1 day. `{days}`: the number. */
  licenseExpiringInDaysOne:
    "Your CopilotKit license expires in {days} day. Please renew.",
  /** License banner when the license expires in any other number of days. `{days}`: the number. */
  licenseExpiringInDaysOther:
    "Your CopilotKit license expires in {days} days. Please renew.",
  /** License banner when the license expired and the date is not known. */
  licenseExpiredText:
    "Your CopilotKit license expired. Please renew at copilotkit.ai/pricing",
  /** License banner when the license expired. `{date}`: the expiry date. */
  licenseExpiredOnDateText:
    "Your CopilotKit license expired on {date}. Please renew at copilotkit.ai/pricing",
  /** License banner when the license token is not valid. */
  licenseInvalidText:
    "Invalid CopilotKit license token. Please check your configuration.",
  /** License banner link when the license expires soon. */
  licenseRenewLabel: "Renew",
  /** License banner link when the license expired. */
  licenseRenewNowLabel: "Renew now",
});

/**
 * Every text of the chat UI, by key. Each value is a `string`, so a translated
 * set fits the same type. See {@link CopilotChatDefaultLabels} for the keys and
 * the default English text.
 */
export type CopilotChatLabels = {
  -readonly [K in keyof typeof CopilotChatDefaultLabels]: string;
};

/**
 * Puts values into a label template. Each `{name}` in the template is replaced
 * by `values[name]`. A placeholder with no value stays in the text as is.
 *
 * @param template - A label value, such as `"Running {name}"`.
 * @param values - The value for each placeholder.
 *
 * ```ts
 * ɵformatLabel(labels.toolCallRunningLabel, { name: "read_file" });
 * // "Running read_file"
 * ```
 */
export function ɵformatLabel(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
