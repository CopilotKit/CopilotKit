/**
 * Chat building blocks that React, Vue, and Angular share: chat text, tool
 * call layout, renderer lookup, the chat input rules, transcription, license
 * state, and icon data.
 *
 * Names without a prefix are public API. Names that start with `ɵ` are
 * internal: the framework packages use them, and they can change in any
 * release.
 */

// Chat text
export { CopilotChatDefaultLabels } from "./labels";
export type { CopilotChatLabels } from "./labels";
export { ɵformatCountLabel, ɵformatLabel } from "./labels";

// Renderer definitions (public)
export type {
  ToolCallRenderProps,
  HumanInTheLoopRenderProps,
  ToolCallRendererDef,
  ActivityMessageRenderProps,
  ActivityMessageRendererDef,
  CustomMessageRendererPosition,
  CustomMessageRenderProps,
  CustomMessageRendererDef,
} from "./renderer-types";

// Renderer lookup (internal)
export {
  ɵresolveToolCallRenderer,
  ɵresolveActivityRenderer,
  ɵresolveCustomMessageRenderers,
  ɵfindActivityRenderer,
  ɵmatchActivityRenderer,
  ɵdescribeActivityRendererFailure,
  ɵgetCustomMessageRenderProps,
  ɵresolveCustomMessageRenderContext,
} from "./renderers";
export type {
  ɵActivityRendererQuery,
  ɵActivityRendererLookup,
  ɵActivityRendererFailureReason,
  ɵCustomMessageRunSource,
} from "./renderers";

// Tool-call render props and status (internal)
export {
  ɵgetToolCallStatus,
  ɵfindToolMessage,
  ɵparseToolCallArguments,
  ɵbuildToolCallRenderProps,
  ɵresolveToolCallAgentId,
  ɵdescribeUnrenderedToolCalls,
  ɵnormalizeToolCallStatus,
  ɵgetToolCallBadge,
  ɵcomponentToolDescription,
} from "./tool-call-render";
export type { ɵToolCallCardStatus } from "./tool-call-render";

// Interrupts (public)
export { INTERRUPT_EVENT_NAME } from "./interrupt-types";
export type {
  InterruptEvent,
  InterruptResolveFn,
  InterruptCancelFn,
  InterruptHandlerProps,
  InterruptRenderProps,
} from "./interrupt-types";

// Tool call layout
export type {
  CopilotChatToolCallDisplay,
  ToolCallEntry,
} from "./tool-call-layout";
export type {
  ToolCallSegment as ɵToolCallSegment,
  ToolCallLayout as ɵToolCallLayout,
  ToolCallRendererNames as ɵToolCallRendererNames,
  ToolCallRendererNamesOptions as ɵToolCallRendererNamesOptions,
  ToolCallDisplayContextValue as ɵToolCallDisplayContextValue,
  TurnWork as ɵTurnWork,
  TurnOpenState as ɵTurnOpenState,
  WorkTime as ɵWorkTime,
  ToolCallRowStatus as ɵToolCallRowStatus,
  ReasoningDuration as ɵReasoningDuration,
  ToolCallGroupAppearance as ɵToolCallGroupAppearance,
} from "./tool-call-layout";
export {
  getToolResults as ɵgetToolResults,
  getToolCallLayouts as ɵgetToolCallLayouts,
  getToolCallRendererNames as ɵgetToolCallRendererNames,
  getLatestTurnKey as ɵgetLatestTurnKey,
  getTurnWork as ɵgetTurnWork,
  isTurnWorking as ɵisTurnWorking,
  isTurnWorkOpen as ɵisTurnWorkOpen,
  getWorkOpenState as ɵgetWorkOpenState,
  recordWorkTime as ɵrecordWorkTime,
  getToolCallRowStatus as ɵgetToolCallRowStatus,
  getToolCallGroupState as ɵgetToolCallGroupState,
  toolCallAppearance as ɵtoolCallAppearance,
  TOOL_CALL_STATUS_LABEL_KEYS as ɵTOOL_CALL_STATUS_LABEL_KEYS,
  TOOL_CALL_STATUS_ICONS as ɵTOOL_CALL_STATUS_ICONS,
  getArgumentPreview as ɵgetArgumentPreview,
  getToolCallPreview as ɵgetToolCallPreview,
  formatToolNames as ɵformatToolNames,
  countFailedToolCalls as ɵcountFailedToolCalls,
  pluralize as ɵpluralize,
  stringifyToolCallPayload as ɵstringifyToolCallPayload,
  stringifyToolCallAttr as ɵstringifyToolCallAttr,
  formatWorkDuration as ɵformatWorkDuration,
  formatReasoningDuration as ɵformatReasoningDuration,
} from "./tool-call-layout";

// Messages (internal)
export { ɵdeduplicateMessages, ɵmessagesFingerprint } from "./messages";

// Attachments (internal)
export { ɵAttachmentQueue, ɵbuildUserMessageContent } from "./attachment-queue";
export type { ɵClipboardItem } from "./attachment-queue";

// Chat session: sends, transcription, thread switches (internal)
export {
  ɵTRANSCRIPTION_ERROR_TIMEOUT_MS,
  ɵappendTranscript,
  ɵbuildUserMessage,
  ɵcreateChatSubmitter,
  ɵChatSubmitter,
  ɵresolveChatNotice,
  ɵstopAgentWithFallback,
  ɵtranscriptionErrorNotice,
  ɵwaitForActiveRun,
} from "./session";
export type {
  ɵChatNotice,
  ɵChatRunScope,
  ɵChatSubmitterOptions,
  ɵChatSubmitterSnapshot,
} from "./session";
export { ɵThreadSelection, ɵThreadSwitchCoordinator } from "./thread-switch";
export type {
  ɵConnectionWaitResult,
  ɵThreadSelectionInput,
} from "./thread-switch";

// Message list (internal)
export {
  ɵcreateMessageViewModel,
  ɵduplicateMessagesWarning,
  ɵMessageViewModel,
  ɵshouldShowMessageCursor,
} from "./message-view";
export type { ɵMessageViewInput } from "./message-view";

// Chat view (internal)
export {
  ɵcreateLastUserMessageTracker,
  ɵgetChatViewState,
  ɵgetLastUserMessageId,
} from "./chat-view";
export type { ɵChatViewStateInput, ɵLastUserMessageState } from "./chat-view";

// Chat input (internal)
export { ɵcomposerButtonState, ɵresolveComposerKey } from "./composer";
export {
  ɵflattenCommandItems,
  ɵfilterCommands,
  ɵparseSlashQuery,
  ɵnextSlashIndex,
  ɵclampSlashIndex,
  ɵresolveSlashKey,
} from "./composer";
export type {
  ɵComposerMode,
  ɵComposerInput,
  ɵComposerKeyEvent,
  ɵCommandMenuItem,
  ɵRunnableCommand,
  ɵSlashMenuState,
  ɵSlashKeyResult,
} from "./composer";

// Chat input layout (internal)
export {
  ɵCOMPOSER_DEFAULT_MAX_ROWS,
  ɵComposerAutosize,
  ɵcreateComposerAutosize,
  ɵmeasureTextarea,
  ɵfitTextareaHeight,
} from "./composer-layout";
export type {
  ɵComposerLayout,
  ɵComposerElements,
  ɵComposerAutosizeOptions,
  ɵTextareaMetrics,
} from "./composer-layout";

// Audio recorder (internal)
export {
  ɵAudioRecorder,
  ɵAudioRecorderError,
  ɵcreateWaveformRenderer,
  ɵrmsAmplitude,
} from "./audio-recorder";
export type { ɵAudioRecorderState } from "./audio-recorder";

// Chat DOM helpers (internal)
export {
  ɵdimensionToCss,
  ɵDockedSidebarRegistry,
  ɵdockedSidebarRegistryFor,
  ɵDockedSidebar,
  ɵcreateDockedSidebar,
  ɵPOPUP_ANIMATION_MS,
  ɵbindPopupDismiss,
  ɵmorphViewTransition,
  ɵbindDialogFocus,
  ɵcanPreviewDocument,
  ɵcreateObjectUrlFromSource,
  ɵdecodeTextSource,
  ɵSCROLL_BOTTOM_THRESHOLD_PX,
  ɵisScrolledToBottom,
} from "./dom";
export type {
  ɵSidebarPosition,
  ɵDockedSidebarPlacement,
  ɵDockedSidebarTransition,
  ɵDockedSidebarState,
  ɵPopupDismissOptions,
  ɵDialogFocusOptions,
} from "./dom";

// Transcription
export { TranscriptionErrorCode, TranscriptionError } from "./transcription";
export type {
  TranscriptionResult,
  TranscriptionErrorInfo,
} from "./transcription";
export {
  ɵtranscribeAudio,
  ɵtranscriptionErrorMessageKey,
} from "./transcription";
export type {
  TranscriptionCore as ɵTranscriptionCore,
  ɵTranscriptionErrorLabelKey,
} from "./transcription";

// License state (internal)
export {
  ɵresolveLicenseState,
  ɵresolveThreadsLicense,
  ɵgetLicenseBannerSpec,
  ɵLICENSE_BANNER_STYLE,
  ɵLICENSE_BANNER_OFFSET,
  ɵreserveLicenseBannerOffset,
  ɵgetInlineFeatureWarningSpec,
  ɵINLINE_FEATURE_WARNING_STYLE,
} from "./license";
export type {
  LicenseStateInput as ɵLicenseStateInput,
  ɵLicenseBannerType,
  ɵLicenseBannerSeverity,
  ɵLicenseBannerDetails,
  ɵLicenseBannerSpec,
} from "./license";

// Icons
export type {
  CopilotIconNode,
  CopilotIconData,
  CopilotIconName,
  CopilotIconDefinition,
} from "./icons";
export { ɵcopilotIcons, ɵcopilotIconSvgAttributes } from "./icons";

// Chat configuration (internal)
export { ɵChatConfigurationStore } from "./chat-configuration";
export type {
  ɵChatConfigurationOptions,
  ɵChatConfigurationSnapshot,
  ɵOpenThreadRegistry,
} from "./chat-configuration";

// Threads drawer binding (internal)
export {
  ɵtoDrawerThread,
  ɵgetThreadsDrawerElementProps,
  ɵfindChatInput,
  ɵcreateThreadsDrawerActions,
} from "./threads-drawer";
export type {
  ɵDrawerThread,
  ɵThreadsDrawerThreads,
  ɵThreadsDrawerConfig,
  ɵThreadsDrawerCallbacks,
} from "./threads-drawer";
// Message feedback (internal)
export {
  ɵMESSAGE_FEEDBACK_EVENT_NAME,
  ɵMESSAGE_FEEDBACK_MAX_COMMENT_LENGTH,
  ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS,
  ɵgetMessageFeedback,
  ɵsubscribeToMessageFeedback,
  ɵsetMessageFeedback,
  ɵresetMessageFeedbackCache,
  ɵisLearningFeedbackEnabled,
  ɵsubscribeToLearningFeedbackEnabled,
  ɵgetMessageFeedbackControls,
  ɵFeedbackCommentController,
} from "./message-feedback";
export type {
  ɵMessageFeedbackRating,
  ɵMessageFeedback,
  ɵMessageFeedbackScope,
  ɵMessageFeedbackControls,
  ɵFeedbackCommentState,
  ɵFeedbackCommentVia,
  ɵFeedbackCommentControllerOptions,
} from "./message-feedback";

// Viewport and scrolling (internal)
export {
  ɵnormalizeAutoScroll,
  ɵMOBILE_MAX_WIDTH_QUERY,
  ɵisMobileViewport,
  ɵwatchMobileViewport,
  ɵKEYBOARD_OPEN_THRESHOLD_PX,
  ɵinitialKeyboardState,
  ɵreadKeyboardState,
  ɵwatchKeyboardState,
  ɵpinMessageToTop,
} from "./viewport";
export type {
  ɵAutoScrollMode,
  ɵKeyboardState,
  ɵPinMessageToTopOptions,
} from "./viewport";

// Message display (internal)
export {
  ɵformatReasoningDurationLabel,
  ɵgetWorkSummaryText,
  ɵflattenUserMessageContent,
  ɵgetUserMessageMediaParts,
  ɵgetUserMessageMediaFilename,
  ɵgetBranchNavState,
  ɵhasAssistantMessageText,
  ɵshouldShowAssistantToolbar,
  ɵCOPY_FEEDBACK_RESET_MS,
  ɵCopyFeedback,
} from "./message-display";
export type {
  ɵWorkSummaryInput,
  ɵUserMessageMediaPart,
  ɵBranchNavInput,
  ɵAssistantToolbarInput,
} from "./message-display";

// Inspector shortcut (internal)
export {
  ɵinspectorShortcuts,
  ɵinspectorKiteIcon,
  ɵinspectorKiteFill,
  ɵHOVER_MENU_CLOSE_DELAY_MS,
  ɵHoverMenuController,
} from "./inspector-button";
export type {
  ɵInspectorKiteArtwork,
  ɵInspectorKitePath,
  ɵInspectorKiteStop,
  ɵInspectorKiteGradient,
  ɵHoverMenuState,
} from "./inspector-button";
