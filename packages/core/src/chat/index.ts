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
} from "./renderers";
export type { ɵActivityRendererQuery } from "./renderers";

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

// Chat input (internal)
export { ɵcomposerButtonState, ɵresolveComposerKey } from "./composer";
export type {
  ɵComposerMode,
  ɵComposerInput,
  ɵComposerKeyEvent,
} from "./composer";

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
export { ɵresolveLicenseState, ɵresolveThreadsLicense } from "./license";
export type { LicenseStateInput as ɵLicenseStateInput } from "./license";

// Icons
export type {
  CopilotIconNode,
  CopilotIconData,
  CopilotIconName,
  CopilotIconDefinition,
} from "./icons";
export { ɵcopilotIcons, ɵcopilotIconSvgAttributes } from "./icons";
