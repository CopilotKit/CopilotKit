import { LitElement, css, html, nothing, render, unsafeCSS } from "lit";
import type { TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import tailwindStyles from "./styles/generated.css";
import inspectorLogoUrl from "./assets/inspector-logo.svg";
import inspectorLogoKiteUrl from "./assets/inspector-logo-kite.svg";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { icons } from "lucide";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type {
  CopilotKitCoreSubscriber,
  ɵThreadStore,
  ɵThread,
  RuntimeLicenseStatus,
} from "@copilotkit/core";
import type { AbstractAgent, Message } from "@ag-ui/client";
import type {
  Anchor,
  ContextKey,
  ContextState,
  DockMode,
  Position,
  Size,
} from "./lib/types.js";
import {
  applyAnchorPosition as applyAnchorPositionHelper,
  centerContext as centerContextHelper,
  constrainToViewport,
  keepPositionWithinViewport,
  updateAnchorFromPosition as updateAnchorFromPositionHelper,
  updateSizeFromElement,
  clampSize as clampSizeToViewport,
} from "./lib/context-helpers.js";
import {
  INSPECTOR_DISMISSAL_MAX_DURATION_MS,
  loadInspectorDismissedUntil,
  loadInspectorState,
  saveInspectorDismissedUntil,
  saveInspectorState,
  isValidAnchor,
  isValidPosition,
  isValidSize,
  isValidDockMode,
} from "./lib/persistence.js";
import type { PersistedState } from "./lib/persistence.js";
import {
  buildPopOutFeatures,
  ensureBrandFont,
  openPopOutWindow,
} from "./lib/pop-out.js";
import type { PopOutHandle } from "./lib/pop-out.js";
import type {
  InspectorMetadataAction,
  InspectorMetadataProjection,
} from "./domains/home/model.js";
import {
  buildHomeModel,
  projectInspectorMetadata,
  runtimeConnectionNeedsAttention,
} from "./domains/home/model.js";
import type { HomeHeroAction, HomeModel } from "./domains/home/model.js";
import type { HomeServiceId, HomeServiceTile } from "./domains/home/model.js";
import {
  copyHomeFeaturePrompt,
  createHomeFeatureSetupState,
  disposeHomeFeatureSetupState,
  homeFeaturePromptCopyState,
} from "./domains/home/feature-setup.js";
import {
  renderFeatureSetupPromptButton,
  renderHomeView as renderHomeDomainView,
} from "./domains/home/view.js";
import { homeViewStyles } from "./domains/home/view.styles.js";
import {
  trackHomeAction,
  trackHomeFeaturePrompt,
  trackHomeView,
} from "./domains/home/telemetry.js";
import {
  clearLegacyAnnouncementReadState,
  loadAnnouncementFeed,
  saveAnnouncementPulsedTimestamp,
  saveAnnouncementReadTimestamp,
} from "./domains/announcements/feed.js";
import type { AnnouncementReady } from "./domains/announcements/feed.js";
import {
  announcementLinkFromClick,
  renderAnnouncementPreview,
  renderAnnouncementsView,
  synchronizeAnnouncementCopyControls,
} from "./domains/announcements/view.js";
import { announcementViewStyles } from "./domains/announcements/view.styles.js";
import { AnnouncementTelemetry } from "./domains/announcements/telemetry.js";
import {
  INSPECTOR_GROUPS,
  INSPECTOR_NAV_SECTIONS,
  getGroupForMenu,
  isInspectorMenuKey,
  shouldUseIconRail,
} from "./lib/inspector-nav.js";
import type { InspectorNavGroupKey, MenuKey } from "./lib/inspector-nav.js";
import {
  TELEMETRY_DOCS_URL,
  ensureTelemetryDistinctId,
  getRuntimeUrlType,
  getTelemetryDistinctIdForUrl,
  maybeShowDisclosure,
  trackErrorSignalViewed,
  trackHomePromptCopied,
  trackHomeStoryBeatSelected,
  trackInspectorOpened,
  trackMetadataActionClicked,
  trackMetadataModuleViewed,
  trackTalkToEngineerClicked,
  trackThreadsEmptyEnabledViewed,
  trackThreadsEnabledViewed,
  trackThreadsExampleSelected,
  trackThreadsExampleTourCompleted,
  trackThreadsExampleTourDismissed,
  trackThreadsExampleTourReopened,
  trackThreadsExampleTourStarted,
  trackThreadsExampleTourStepViewed,
  trackThreadsExampleViewed,
  trackThreadsIntelligenceSignupClicked,
  trackThreadsLockedViewed,
  trackThreadsTabClicked,
  trackThreadsTalkToEngineerClicked,
} from "./lib/telemetry.js";
import {
  createOnboardingPrompt,
  createOnboardingRunId,
} from "./lib/onboarding-prompt.js";
import { normalizeDisplayValue } from "./shared/display/display-value.js";
import type { DisplayValue } from "./shared/display/types.js";
import type {
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
} from "./shared/thread-debugger/types.js";
import { CpkMemoryList as LearningMemoryList } from "./domains/learning/memory-list.js";
import {
  maxRecallScore,
  normalizeRelevance,
  relevanceBarWidth,
  runLearningRecall,
} from "./domains/learning/recall.js";
import {
  clearRecall as clearLearningRecall,
  createLearningState,
  resetLearningState,
  setRecallQuery,
} from "./domains/learning/state.js";
import { ensureLearningSubscription } from "./domains/learning/subscription.js";
import { trackLearningTabClicked } from "./domains/learning/telemetry.js";
import {
  LEARNING_VIEW_LABEL,
  MEMORY_LOAD_ERROR_LABEL,
  renderLearningView,
} from "./domains/learning/view.js";
import { learningViewStyles } from "./domains/learning/view.styles.js";
import {
  retryPlaygroundRun,
  sendPlaygroundMessage,
  submitPlaygroundOnEnter,
  updatePlaygroundInput,
} from "./domains/playground/composer.js";
import { isPlaygroundSelectElement } from "./domains/playground/element-guards.js";
import { mapPlaygroundMessagesToAgent } from "./domains/playground/message-adapter.js";
import {
  clearPlaygroundSession,
  createPlaygroundSession,
  createPlaygroundSubscriber,
  loadPlaygroundThread,
  resolvePlaygroundAgentId,
  runPlaygroundAgent,
  syncPlaygroundMessages,
} from "./domains/playground/session.js";
import { createPlaygroundState } from "./domains/playground/state.js";
import {
  AGENT_SCOPE_POPUP_ID,
  AGENT_SCOPE_TRIGGER_ID,
  createLiveInspectionState,
} from "./domains/live-inspection/state.js";
import type {
  InspectorAgentEventType,
  InspectorEvent,
  InspectorMessage,
  InspectorToolCall,
  InspectorToolDefinition,
} from "./domains/live-inspection/state.js";
import {
  normalizeAgentMessages,
  subscribeToAgent as subscribeLiveAgent,
  teardownAgentSubscriptions as teardownLiveAgentSubscriptions,
  unsubscribeFromAgent as unsubscribeLiveAgent,
} from "./domains/live-inspection/agent-adapter.js";
import { recordEvent as recordLiveEvent } from "./domains/live-inspection/event-buffer.js";
import {
  EMPTY_INSPECTOR_MESSAGES,
  agentStats,
  agentStatus,
  hasRenderableState,
  latestMessagesForAgent,
  latestStateForAgent,
  liveAgentMessagesForThread,
} from "./domains/live-inspection/agents/model.js";
import {
  renderAgentScopeDropdown,
  renderAgentsView as renderLiveAgentsView,
} from "./domains/live-inspection/agents/view.js";
import { buildCapabilityRows } from "./domains/live-inspection/capabilities/model.js";
import type { CapabilityToolRow } from "./domains/live-inspection/capabilities/model.js";
import { renderCapabilitiesView as renderLiveCapabilitiesView } from "./domains/live-inspection/capabilities/view.js";
import { normalizeContextStore } from "./domains/live-inspection/context/model.js";
import { renderContextView as renderLiveContextView } from "./domains/live-inspection/context/view.js";
import {
  clearEvents,
  eventsForSelectedContext,
  resetEventFilters,
  resizeEventColumn,
} from "./domains/live-inspection/events/model.js";
import { renderEventsView } from "./domains/live-inspection/events/view.js";
import { liveInspectionViewStyles } from "./domains/live-inspection/events/view.styles.js";
import {
  refreshToolsSnapshot as refreshLiveToolsSnapshot,
  toolsForAgent,
} from "./domains/live-inspection/tools/model.js";
import {
  renderAgentToolsSection as renderLiveAgentToolsSection,
  renderToolsView as renderLiveToolsView,
} from "./domains/live-inspection/tools/view.js";
import { renderPlaygroundView as renderPlaygroundDomainView } from "./domains/playground/view.js";
import { playgroundViewStyles } from "./domains/playground/view.styles.js";
import { CpkThreadList } from "./domains/threads/list/thread-list.js";
import {
  CpkThreadInspector,
  ɵCpkThreadDetails,
} from "./domains/threads/detail/thread-inspector.js";
import type { ThreadDetailsTab } from "./domains/threads/detail/thread-inspector.js";
import {
  areThreadEndpointsAvailable,
  getThreadServiceStatus,
  hasVisibleSettledRealThreads,
  selectActiveThreadsState,
  selectRealThread,
  selectVisibleRealThreadId,
  shouldRenderExampleThreads,
} from "./domains/threads/selectors.js";
import { createThreadsState } from "./domains/threads/state.js";
import {
  getExampleKind,
  THREADS_EXAMPLE_THREADS,
} from "./domains/threads/examples/data.js";
import {
  getExampleThreadProvider,
  isExampleThreadId,
} from "./domains/threads/examples/provider.js";
import {
  clearThreadsUsageRefresh,
  getMetadataActionPlacement,
  getThreadsCapacityState,
  getThreadsExpiryBucket,
  getThreadsUsageBucket,
  renderThreadsUsageFooter as renderThreadsDomainUsageFooter,
  scheduleThreadsUsageRefresh,
} from "./domains/threads/usage.js";
import {
  cancelThreadRefreshDebounce,
  ensureOwnedThreadStore as ensureOwnedStore,
  rebuildFlattenedThreads,
  refreshOwnedThreadStore as refreshOwnedStore,
  removeOwnedThreadStore as removeOwnedStore,
  getViewInAppMode as selectViewInAppMode,
  stopViewingThreadInApp,
  subscribeToThreadStore as subscribeThreadStore,
  subscribeToInspectorThreadBridge as subscribeThreadBridge,
  teardownOwnedThreadStores as teardownOwnedStores,
  teardownThreadStoreSubscriptions as teardownThreadSubscriptions,
  unsubscribeFromInspectorThreadBridge as unsubscribeThreadBridge,
  updateOwnedThreadStoreHeaders as updateOwnedStoreHeaders,
  viewThreadInApp,
} from "./domains/threads/store-bridge.js";
import {
  dismissExampleTour as dismissTour,
  getExampleTourTelemetryPair,
  readExampleTourDismissed,
  setExampleTourStep as updateExampleTourStep,
  startExampleTour as activateExampleTour,
  THREADS_EXAMPLE_TOUR_STEPS,
  writeExampleTourDismissed,
} from "./domains/threads/examples/tour.js";
import {
  claimExampleSelected,
  claimExampleTourStep,
  claimExampleViewed,
  claimThreadsViewState,
} from "./domains/threads/telemetry/events.js";
import {
  getThreadsEmptyOnboardingAction,
  renderThreadsOverview,
  renderThreadsTour,
  renderThreadsView as renderThreadsDomainView,
  selectThread,
  SELF_HOSTED_INTELLIGENCE_URL,
  THREADS_DOCS_URL,
} from "./domains/threads/view.js";
import {
  cleanupThreadsExampleVideo,
  controlThreadsExampleVideo,
  reconcileThreadsExampleVideo,
  renderThreadsExampleVideo,
} from "./domains/threads/examples/video.js";
import { threadsViewStyles } from "./domains/threads/view.styles.js";
import {
  INSPECTOR_COPY_BUTTON_TAG,
  InspectorCopyButtonElement,
} from "./ui/copy-button/copy-button.js";
import {
  INSPECTOR_JSON_VIEWER_TAG,
  InspectorJsonViewerElement,
} from "./ui/json-viewer/json-viewer.js";
import type {
  ExampleKind,
  ExampleTourStep,
  ExampleTourTab,
  InspectorGroupKey,
  InspectorMetadataLicenseBucket,
  InspectorMetadataModuleViewedTelemetryProps,
  InspectorMetadataTelemetryModule,
  InspectorErrorSignalSource,
  InspectorEventErrorSource,
  InspectorWiringErrorSource,
  InspectorOpenSource,
  InspectorThreadTelemetryProps,
  ThreadsExpiryBucket,
  ThreadsUsageBucket,
} from "./lib/telemetry.js";

export type { Anchor } from "./lib/types.js";
export type {
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
  ThreadDebuggerProviderLoadOptions,
  ThreadDebuggerToolCall,
} from "./shared/thread-debugger/types.js";
export { CpkThreadInspector, ɵCpkThreadDetails };
export { buildCapabilityRows as ɵbuildCapabilityRows } from "./domains/live-inspection/capabilities/model.js";
export type { CapabilityToolRow as ɵCapabilityToolRow } from "./domains/live-inspection/capabilities/model.js";

export type InspectorOpenOptions = {
  /** Select the thread that contains the message. */
  threadId?: string;
  /** Narrow the Threads view to the agent that owns the thread. */
  agentId?: string;
  /** Scroll the selected thread timeline to this message when available. */
  messageId?: string;
};

export const WEB_INSPECTOR_TAG = "cpk-web-inspector" as const;
export const THREAD_INSPECTOR_TAG = "cpk-thread-inspector" as const;

/**
 * User-facing label for the What's new view. Its menu key stays `whats-new`
 * for persistence and telemetry stability, following the `memories`/"Memory"
 * precedent above.
 */
const WHATS_NEW_VIEW_LABEL = "What's new";

/** Menu key of the What's new leaf — the news signal's destination. */
const WHATS_NEW_MENU_KEY = "whats-new";

interface RuntimeEntitlementDisplayDiagnostic {
  status: "ready" | "degraded" | "misconfigured" | "unavailable";
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string;
    traceId?: string;
  };
}

type LucideIconName = keyof typeof icons;

type MenuItem = {
  key: MenuKey;
  label: string;
  icon: LucideIconName;
};

// ── Launcher signals ──────────────────────────────────────────────────────
//
// There is one dot on the closed launcher and more than one thing that can
// claim it, so each subject is described once, here, and every call site reads
// the description rather than hardcoding a subject.
//
// The rule for this table is **no field without a second consumer**. That is
// why there is no lifecycle field (one value was ever used, and "never
// persisted" is expressed by not persisting) and why the two destinations are
// separate: the news signal genuinely marks one entry and lands on another.
//
// This reintroduces a small shared shape where an earlier generic version was
// removed as speculative. That removal was correct at the time — the
// abstraction had exactly one user. A second user now exists.
//
// **The two subjects beat by different rules, deliberately**: an error beats
// once per outage, an announcement once per tab per announcement. That follows
// from a recurring condition versus a one-time publication. Do not harmonise
// them; harmonising breaks one of them.

/** Tone drives colour only. The launcher treatment is shared by every tone. */
type LauncherSignalTone = "news" | "error";

/**
 * The error keys ARE the telemetry enum, so a source can never be reported
 * under a name the signal table does not describe.
 */
type LauncherSignalKey = "whats-new" | InspectorErrorSignalSource;

type LauncherSignalDefinition = Readonly<{
  tone: LauncherSignalTone;
  /** Which navigation entry carries the marker while this signal is armed. */
  markerTarget: MenuKey;
  /** Where a press on the launcher opens while this signal owns the dot. */
  landingTarget: MenuKey;
  /** One beat's duration. Errors beat faster than product news. */
  cadence: number;
  /** Higher wins the single dot. Errors outrank news. */
  priority: number;
  /**
   * Suffix appended to the marked navigation entry's accessible name, and —
   * for error tones only — to the launcher's own accessible name. Never
   * rendered as visible text: the dot says there is something to look at, and
   * the panel says what.
   */
  accessibleLabel: string;
  /**
   * The words the launcher opens sideways to show, and the words spoken once
   * into the polite live region. Absent means this subject opens no pill.
   *
   * Read from the signal rather than from a condition on the tone, so a third
   * signal can carry a pill by declaring one — and whoever declares it owns
   * the width problem that keeps the announcement out. The announcement's feed
   * preview measures 54 characters against a 36-pixel launcher, and the width
   * would be set by a feed we do not control.
   *
   * These are the words the panel already uses, never a paraphrase, so a
   * reader who sees the pill and then opens the panel has nothing to
   * reconcile. The failure *message* is never carried here — for width, and
   * because it can contain prompts, URLs and identifiers.
   */
  pillLabel?: string;
}>;

const NEWS_SIGNAL_ID = "whats-new" as const;
const NEWS_SIGNAL_COLOR = "#A78BFA";
/**
 * The error tone's red. Bright enough to read against the launcher's dark
 * face at the same perceived weight as the news lilac, and in the same family
 * as System Health's error tone (#b32d3b light / #ff9aa0 dark), which is too
 * dark and too pale respectively to use directly on the launcher.
 */
const ERROR_SIGNAL_COLOR = "#F87171";

const LAUNCHER_SIGNAL_COLORS: Readonly<Record<LauncherSignalTone, string>> = {
  news: NEWS_SIGNAL_COLOR,
  error: ERROR_SIGNAL_COLOR,
};

/**
 * The failure gesture, four phases in series:
 *
 * ```
 * beat 400ms  →  open 250ms  →  hold 2500ms  →  close 250ms   (3400ms total)
 * ```
 *
 * Sequential rather than simultaneous, deliberately: the beat says *here*, the
 * pill says *this*. The beat is short so the words arrive quickly.
 *
 * **All four durations live here and nowhere else.** The stylesheet reads the
 * two animated phases as custom properties injected from these numbers rather
 * than restating them, because they are taste and will be tuned by eye after
 * the first live look — tuning the feel must be a number, not a refactor.
 */
const ERROR_GESTURE_MS = {
  /** Phase 1: one beat, which is also the error signals' cadence. */
  beat: 400,
  /** Phase 2: the sideways reveal. */
  open: 250,
  /** Phase 3: long enough to read three words without hurrying. */
  hold: 2500,
  /** Phase 4: back to the plain mark with its dot. */
  close: 250,
} as const;

/**
 * The words the pill carries, which are the words the panel already carries.
 *
 * `Runtime error` is the System Health runtime tile's own label, and
 * `Failed to load threads` is the Threads view's own heading. The outside and
 * the inside must agree, so these are shared rather than paraphrased.
 */
const RUNTIME_ERROR_LABEL = "Runtime error";
const THREADS_LOAD_ERROR_LABEL = "Failed to load threads";
const AGENT_RUN_FAILED_LABEL = "Agent run failed";
const TOOL_ERROR_LABEL = "Tool error";

/**
 * Copy on the landing view. Titles match the pill.
 *
 * The two fields differ in what they can promise. `advice` is about the
 * reader's next move and is always true. `highlight` is a claim about *this
 * view* — that the failed item is visible below — and the error carries no
 * guarantee of that: a code mapped to `run` can arrive with no run in the
 * buffer at all, and a tool error can arrive without the call id the
 * highlight needs. So it is rendered only once the item is actually there.
 * A card pointing at something the reader cannot find is worse than a card
 * that stays quiet, because it sends them looking.
 */
const EVENT_ERROR_GUIDANCE: Readonly<
  Record<
    InspectorEventErrorSource,
    Readonly<{ title: string; advice?: string; highlight?: string }>
  >
> = {
  run: {
    title: AGENT_RUN_FAILED_LABEL,
    highlight: "The failed run event is highlighted below.",
  },
  tool: {
    title: TOOL_ERROR_LABEL,
    highlight: "The failed tool call is highlighted below.",
  },
  memory: {
    title: MEMORY_LOAD_ERROR_LABEL,
    advice:
      "Confirm CopilotKit Intelligence is connected, then retry Learning.",
  },
};

/**
 * The pill's second line, shared by every subject that carries a pill.
 *
 * **This is the one string in the feature that exists nowhere else in the
 * product.** Every other word the launcher shows is word-identical to the
 * panel, which is the standing rule; this line is a deliberate, owner-approved
 * exception to it, because the pill became clickable and an invitation that
 * says nothing is not an invitation.
 *
 * It is shown, never spoken: the polite live region carries the failure class
 * alone. A screen-reader user cannot act on an instruction delivered through
 * an announcement, and it would double the spoken length.
 */
const PILL_SUBLINE_LABEL = "Open Inspector for details";

type LauncherHudRowId = "threads" | "learning";

const HUD_INSPECTOR_LABEL = "CopilotKit Inspector";
const HUD_ANNOUNCEMENT_TITLE_LIMIT = 80;
const HUD_THREADS_LABEL = "Rich Threads";
const HUD_LEARNING_LABEL = "Automatic Learning";
const HUD_LEARN_MORE_LABEL = "Click to learn more";

type InspectorDismissalDuration = "day" | "week";
const INSPECTOR_DISMISSAL_MS: Readonly<
  Record<InspectorDismissalDuration, number>
> = {
  day: 24 * 60 * 60 * 1000,
  week: INSPECTOR_DISMISSAL_MAX_DURATION_MS,
};
const LAUNCHER_SIGNALS: Readonly<
  Record<LauncherSignalKey, LauncherSignalDefinition>
> = {
  // Marks What's new, lands on Home: Home carries the preview band that is
  // the way onward. Unchanged from before this table existed.
  "whats-new": {
    tone: "news",
    markerTarget: WHATS_NEW_MENU_KEY,
    landingTarget: "home",
    cadence: 2100,
    priority: 0,
    accessibleLabel: "new content",
  },
  // Errors mark and land on the same place, because the place that carries
  // the marker is the place that explains the failure.
  connection: {
    tone: "error",
    markerTarget: "home",
    landingTarget: "home",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 5,
    accessibleLabel: "runtime error",
    pillLabel: RUNTIME_ERROR_LABEL,
  },
  threads: {
    tone: "error",
    markerTarget: "threads",
    landingTarget: "threads",
    cadence: ERROR_GESTURE_MS.beat,
    // Below the connection signal: a connection failure cascades into thread
    // failures, so when both could be armed the root cause owns the dot.
    priority: 4,
    accessibleLabel: "thread loading error",
    pillLabel: THREADS_LOAD_ERROR_LABEL,
  },
  // Unread *events*. They beat and name the failure, then clear when the
  // landing view is read. They lose the launcher dot to wiring state.
  run: {
    tone: "error",
    markerTarget: "ag-ui-events",
    landingTarget: "ag-ui-events",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 3,
    accessibleLabel: "agent run failed",
    pillLabel: AGENT_RUN_FAILED_LABEL,
  },
  tool: {
    tone: "error",
    markerTarget: "agents",
    landingTarget: "agents",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 2,
    accessibleLabel: "tool error",
    pillLabel: TOOL_ERROR_LABEL,
  },
  memory: {
    tone: "error",
    markerTarget: "memories",
    landingTarget: "memories",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 1,
    accessibleLabel: "learning error",
    pillLabel: MEMORY_LOAD_ERROR_LABEL,
  },
};

/** Highest priority first, so the winner of the single dot is the head. */
const LAUNCHER_SIGNAL_PRIORITY_ORDER: ReadonlyArray<LauncherSignalKey> = (
  Object.keys(LAUNCHER_SIGNALS) as LauncherSignalKey[]
).sort((a, b) => LAUNCHER_SIGNALS[b].priority - LAUNCHER_SIGNALS[a].priority);

/** Wiring *state* — red until the problem heals. */
const WIRING_ERROR_KEYS = [
  "connection",
  "threads",
] as const satisfies ReadonlyArray<InspectorWiringErrorSource>;

/** Unread *events* — red until the landing view is read. */
const EVENT_ERROR_KEYS = [
  "run",
  "tool",
  "memory",
] as const satisfies ReadonlyArray<InspectorEventErrorSource>;

type InspectorEventErrorDetails = Readonly<{
  message: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
}>;

function isWiringErrorKey(
  key: LauncherSignalKey,
): key is InspectorWiringErrorSource {
  return (WIRING_ERROR_KEYS as readonly string[]).includes(key);
}

/**
 * Takes a plain string rather than a `LauncherSignalKey`, because one caller
 * reads the subject back out of a `data-` attribute, where the DOM can only
 * offer `string | undefined`. Narrowing untrusted input is what a guard is
 * for; `LauncherSignalKey` still satisfies the parameter, so the callers that
 * already hold one are unaffected.
 */
function isEventErrorKey(key: string): key is InspectorEventErrorSource {
  return (EVENT_ERROR_KEYS as readonly string[]).includes(key);
}

/** Narrows a signal key to an error source, excluding the announcement. */
function isErrorSignalKey(
  key: LauncherSignalKey,
): key is InspectorErrorSignalSource {
  return isWiringErrorKey(key) || isEventErrorKey(key);
}

/**
 * The control range is the point, not an oversight: an attribute selector has
 * to escape those characters too, and CSS.escape — which the fallback below
 * stands in for — escapes them as well. Hoisted so the suppression can sit on
 * the pattern rather than three lines above it.
 */
// oxlint-disable no-control-regex -- deliberate, see above
const SELECTOR_ESCAPE_PATTERN =
  /[\0-\x1f\x7f!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;
// oxlint-enable no-control-regex

/** Attribute selector value. jsdom does not implement CSS.escape. */
function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(SELECTOR_ESCAPE_PATTERN, "\\$&");
}

function eventErrorKeyForCode(
  code: CopilotKitCoreErrorCode,
): InspectorEventErrorSource | null {
  switch (code) {
    case CopilotKitCoreErrorCode.TOOL_NOT_FOUND:
    case CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED:
    case CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED:
    case CopilotKitCoreErrorCode.AGENT_NOT_FOUND:
      return "tool";
    case CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED:
    case CopilotKitCoreErrorCode.AGENT_RUN_FAILED:
    case CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT:
    case CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT:
      return "run";
    default:
      return null;
  }
}

/**
 * Coalesce inspector-owned GET /threads sends. The first refresh goes out
 * at once. Further calls in this window share one trailing request, so a
 * flaky network does not fire a burst of list fetches and error cards.
 */

/** The launcher's accessible name with nothing wrong. */
const LAUNCHER_BASE_LABEL = "Web Inspector";

/**
 * Where the pill is in the gesture.
 *
 * `closed` covers the whole beat: the pill is laid out at its full width and
 * clipped to nothing from the first frame, so the room it needs can be
 * measured before anything is shown and the reveal has nothing left to
 * compute.
 */
type LauncherPillPhase = "closed" | "opening" | "holding" | "closing";

/**
 * Which side the pill grows towards. The launcher is anchored top-right, so
 * the natural direction is leftwards, away from its own edge — but it is
 * draggable and its position persists, so a reader who parked it near the left
 * edge would otherwise get a permanently truncated pill.
 */
type LauncherPillDirection = "left" | "right";

/**
 * Whether the reader actually got a pill. `suppressed` is the honest-degrade
 * case: neither side had room, so the dot and the beat fire alone.
 */
type LauncherPillOutcome = "shown" | "suppressed";

type CoreStatusSummary = Readonly<{
  label: string;
  state: "connected" | "connecting" | "disconnected" | "error" | "unavailable";
  description: string;
}>;

type InspectorColorScheme = "light" | "dark";

const EDGE_MARGIN = 16;
/** HUD card plus the hover bridge. Used to pick left vs right. */
const LAUNCHER_HUD_WIDTH = 258;
/**
 * One page-load preview of the launcher's feature HUD.
 *
 * The card arrives after the host page has had a beat to settle. Its feature
 * contents then arrive from top to bottom, stay readable, and leave together.
 * Nothing is persisted: a new Inspector element means a new preview.
 */
const LAUNCHER_HUD_INTRO_MS = {
  delay: 500,
  duration: 3400,
  waterfallStart: 180,
  waterfallStagger: 170,
  waterfallDuration: 300,
  blockedRetry: 250,
} as const;

/** Return the staggered reveal delay for one launcher HUD layer. */
const launcherHudWaterfallDelay = (introIndex: number): string =>
  `${
    LAUNCHER_HUD_INTRO_MS.waterfallStart +
    introIndex * LAUNCHER_HUD_INTRO_MS.waterfallStagger
  }ms`;
const DRAG_THRESHOLD = 6;
const MIN_WINDOW_WIDTH = 880;
const MIN_WINDOW_WIDTH_DOCKED_LEFT = 640;
const MIN_WINDOW_HEIGHT = 480;
const INSPECTOR_STORAGE_KEY = "cpk:inspector:state";
// The launcher keeps its current touch target on compact screens and grows to
// an exactly 20% larger desktop cap. `box-sizing` makes these OUTER sizes.
const LAUNCHER_MIN_SIZE = 51.84;
const LAUNCHER_MAX_SIZE = 62.208;
const DEFAULT_BUTTON_SIZE: Size = {
  width: LAUNCHER_MIN_SIZE,
  height: LAUNCHER_MIN_SIZE,
};
const DEFAULT_WINDOW_SIZE: Size = { width: 960, height: 740 };
const DOCKED_LEFT_WIDTH = 720;
const INTERACTIVE_FOCUS_BASE_STYLE =
  "outline-style:solid;outline-width:2px;outline-color:transparent;outline-offset:2px;cursor:pointer;";
// Cap on banner impressions held while waiting for the runtime handshake, so a
// runtime that never connects can't accumulate an unbounded queue.
const INTELLIGENCE_SIGNUP_URL = "https://intelligence.copilotkit.ai";
const TALK_TO_ENGINEER_URL = "https://www.copilotkit.ai/talk-to-an-engineer";
// Label for the Capabilities tab (client-authoritative dev experimentation
// surface: toggle frontend tools + A2UI catalog components on/off, enforced
// immediately via core.setToolEnabled / core.setCatalogComponentEnabled).
// Renameable — keep the display string in this one place.
const CAPABILITIES_TAB_LABEL = "Capabilities";

function createPlaygroundThreadId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `playground-${Date.now()}`;
}
// ── The Intelligence story on Home ────────────────────────────────────────
//
// A condensed cut of the six-phase animation on the Intelligence home page
// (`react-shell/src/home/learning-sample*`). Three beats, not six: the two
// thread beats there open on the agent booking the wrong meeting, which is a
// poor first frame for a card whose job is to argue for the product, and the
// handoff beat only bridges between them.
//
// What is kept is the machinery a developer cannot hand-roll — many threads
// collapsing into one pattern — then the artefact it produces, then the loop.
// `meeting-scheduling.md` recurs in all three on purpose: the same filename
// appearing in the last beat's badge is what turns the closing diagram from a
// claim into something checkable.
//
// Durations are the shipped values for the corresponding phases upstream, so
// the pacing stays recognisable to anyone who has seen the original.
// Each beat owns its own two sentences, and the card shows exactly the pair
// that belongs to the picture on screen. An earlier version argued for Threads
// in prose while the animation showed Learning — two half-claims sitting next
// to each other, neither supporting the other. Bound together they read as one
// chain: your users' threads → the pattern in them → the file → it applies
// itself.
//
// `lead` is the sentence that has to land on its own. `support` earns it.
// Nothing else: a third line here is what makes this card feel crowded.
const INTELLIGENCE_STORY_BEATS = [
  {
    id: "threads",
    label: "Threads",
    // Roughly 24 words of copy plus a picture to take in. The upstream timings
    // were written for a page where the animation carried itself; here it has
    // to be read, so every beat gets time for two sentences at a comfortable
    // pace rather than a glance. The rail is there for anyone who wants to
    // move faster.
    duration: 6_500,
    // "Your users" means the end users of the developer's app, not the
    // developer. That is what the platform means too: `identifyUser` resolves
    // one `{id, name}` per request from the app, and a thread carries
    // `end_user_id` — a column renamed from `user_id` precisely because the
    // old name "caused repeated misdiagnosis" against control-plane users.
    //
    // No count in the claim. A developer wiring this up locally has no users
    // yet, and "thousands" would read as a lie on day one while still being
    // true at scale. "All the others" holds in both cases.
    lead: "You only see this session. Your users have all the others.",
    // "Rich Threads" is the product's own name for the durable ones, and the
    // distinction is the sale: the Inspector's Threads tab already lists local
    // ones that die on reload.
    support:
      "Rich Threads keep every conversation and its state, so you can open the one that broke instead of reproducing it.",
  },
  {
    id: "learning",
    label: "Learning",
    duration: 6_000,
    lead: "Your users already told you what to fix.",
    // Insights are a first-class concept in the product, and the evidence link
    // is the credibility hook for a sceptical developer: a claim you can open,
    // not a model's opinion. Learning's own onboarding leads with "46 evidence
    // refs" across "12 Threads" for exactly this reason.
    support:
      "Learning reads the runs behind those threads and finds the patterns — every Insight linked to the messages that back it.",
  },
  {
    id: "skill",
    label: "Skills",
    duration: 5_500,
    lead: "An Insight becomes a skill you own.",
    // The review step is real (candidates land at pending_review and a human
    // approves), but it is sold as control rather than as reassurance. The
    // earlier wording — "nothing reaches your agent until you approve it" —
    // answered a fear the reader had not voiced yet, which reads as a defence
    // and plants the worry it deflects. Ownership is the same fact, stated as
    // a feature: a readable file you review, edit and ship.
    support:
      "A SKILL.md built from that evidence — yours to review, edit and ship with your project.",
  },
  {
    id: "intelligence",
    // Named after the product, not after the mechanism. The other three tabs
    // are the parts; this one is the whole, so the rail reads "Threads ·
    // Learning · Skills · Intelligence" — the pieces, then the thing that
    // unites them. "Reuse" named neither a surface nor an outcome.
    label: "Intelligence",
    duration: 6_000,
    lead: "Every round of real use leaves your agent better.",
    // Deliberately NOT "Skills apply it for you". The platform does not apply
    // skills at run time — there is no run-time read of published skills, only
    // a bundle the developer pulls down with `copilotkit skills download`.
    // Claiming automatic application would be a promise the product does not
    // keep, and the first developer to check would stop believing the rest.
    support:
      "Approve a skill, pull it into your project, and the next run starts from what already worked.",
  },
] as const;

/**
 * The threads the first beat shows.
 *
 * One of them failed, because that is the row a developer actually wants and
 * the reason durable threads are worth paying for. It is a user's thread that
 * went wrong, not a demo of our agent failing — the distinction matters for a
 * card that has to argue for the product.
 */
const INTELLIGENCE_STORY_THREADS = [
  { title: "Reschedule the Tuesday sync", meta: "2 min ago", failed: false },
  {
    title: "Book time with the design team",
    meta: "18 min ago",
    failed: false,
  },
  { title: "Booked the wrong slot", meta: "Needs a look", failed: true },
] as const;

/** The three rules the story derives, shown verbatim across all three beats. */
const INTELLIGENCE_STORY_RULES = [
  "Check both calendars.",
  "Propose several times.",
  "Ask before booking.",
] as const;

/**
 * The raw thread signals the first beat collapses into those rules.
 *
 * Kept at real-message length and varied on purpose — these have to read as
 * things people actually typed, not as three tidy bullet points. The longest
 * one truncates in a narrow panel, which is honest: it is an excerpt.
 */
const INTELLIGENCE_STORY_SIGNALS = [
  "Check our calendars and find a time for both of us.",
  "Could you share a few options?",
  "Ask me before you book it.",
] as const;

// A skill really is a directory holding a SKILL.md, so the path shows both the
// skill's name and the document the platform actually stores.
const INTELLIGENCE_STORY_SKILL_FILE = "meeting-scheduling/SKILL.md";

/**
 * How long the copied confirmation stands before the button invites a second
 * press. Longer than the 2s the Threads setup prompt uses, because this state
 * also carries an instruction that has to be read, not just an acknowledgement.
 */
const PROMPT_COPY_RESET_MS = 4_000;

// The real pipeline, named the way the product names it: threads produce
// evidence-backed Insights, Insights produce Skill candidates, a human
// approves, and the approved set is what the project pulls in. `Lightbulb` is
// Learning's own icon for an Insight, so the two surfaces agree.
const INTELLIGENCE_STORY_CHAIN = [
  {
    icon: "MessagesSquare",
    name: "Threads",
    detail: "Every conversation",
  },
  { icon: "Lightbulb", name: "Insights", detail: "Backed by evidence" },
  { icon: "FileText", name: "Skills", detail: "You approve" },
  { icon: "Wand2", name: "Your agent", detail: "Starts from what worked" },
] as const;
type HomeFeaturePromptCopyState = "idle" | "copied" | "error";

type SanitizedValue = DisplayValue;

function coerceJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  const looksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function renderJsonValue(
  value: unknown,
  options: {
    maxHeight?: string;
    copyable?: boolean;
    copyLabel?: string;
    clipboard?: Pick<Clipboard, "writeText">;
  } = {},
) {
  const parsed = coerceJsonValue(value);
  return html`<cpk-inspector-json-viewer
    .value=${parsed}
    .maxHeight=${options.maxHeight ?? ""}
    .copyable=${options.copyable ?? false}
    .copyLabel=${options.copyLabel ?? "Copy"}
    .clipboard=${options.clipboard}
  ></cpk-inspector-json-viewer>`;
}

function humanizeEventType(type: string): string {
  const words = type
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return "Event";
  const [first = "event", ...rest] = words;
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(
    " ",
  );
}

function messageTitle(role: string): string {
  const normalized = role.trim() || "message";
  const label = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`;
  return `${label} message`;
}

function eventCategory(
  type: string,
): "message" | "tool" | "state" | "run" | "error" | "event" {
  if (type === "RUN_ERROR" || type === "ERROR") return "error";
  if (type.startsWith("TEXT_MESSAGE")) return "message";
  if (type.startsWith("TOOL_CALL")) return "tool";
  if (type.startsWith("STATE") || type.startsWith("MESSAGES")) return "state";
  if (type.startsWith("RUN_") || type.startsWith("STEP_")) return "run";
  return "event";
}

function formatTimestamp(ts: string | number): string {
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return (
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) +
    "." +
    ms
  );
}

function formatRelativeTimestamp(ts: string | number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";

  const elapsedSeconds = Math.max(
    1,
    Math.floor((Date.now() - date.getTime()) / 1_000),
  );
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} ${elapsedSeconds === 1 ? "second" : "seconds"} ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
}

export {
  normalizeRelevance as ɵnormalizeRelevance,
  maxRecallScore as ɵmaxRecallScore,
  relevanceBarWidth as ɵrelevanceBarWidth,
};

// Backwards-compatible internal element name used by the full CopilotKit
// Inspector shell. Keep this class thin so the public body remains the single
// implementation.
function defineElementOnce(
  registry: CustomElementRegistry,
  tag: string,
  ctor: CustomElementConstructor,
): void {
  if (!registry.get(tag)) {
    registry.define(tag, ctor);
  }
}

export class WebInspectorElement extends LitElement {
  static properties = {
    core: { attribute: false },
    autoAttachCore: { type: Boolean, attribute: "auto-attach-core" },
    _capabilitiesVersion: { state: true },
  } as const;

  private _core: CopilotKitCore | null = null;
  private coreSubscriber: CopilotKitCoreSubscriber | null = null;
  private coreUnsubscribe: (() => void) | null = null;
  private runtimeStatus: CopilotKitCoreRuntimeConnectionStatus | null = null;
  private inspectorMetadataValue: unknown;
  private inspectorMetadataProjection: InspectorMetadataProjection =
    projectInspectorMetadata(undefined, undefined);
  // The last *visible* local fingerprint for each metadata module. This is a
  // map rather than a cumulative set so A → B → A produces three impressions,
  // while close/reopen with unchanged metadata produces only one. Fingerprint
  // values can contain local labels and URLs because the map never leaves the
  // browser; outbound helpers rebuild a coarse allowlisted payload.
  private metadataTelemetryFingerprints: Map<
    InspectorMetadataTelemetryModule,
    string
  > = new Map();
  private coreProperties: Readonly<Record<string, unknown>> = {};
  private lastCoreError: {
    code: CopilotKitCoreErrorCode;
    message: string;
  } | null = null;
  private readonly live = createLiveInspectionState();

  private get agentSubscriptions() {
    return this.live.agentSubscriptions;
  }

  private get agentEvents() {
    return this.live.agentEvents;
  }

  private get agentMessages() {
    return this.live.agentMessages;
  }

  private get agentStates() {
    return this.live.agentStates;
  }

  private get flattenedEvents() {
    return this.live.flattenedEvents;
  }

  private set flattenedEvents(events: InspectorEvent[]) {
    this.live.flattenedEvents = events;
  }

  private get eventCounter() {
    return this.live.eventCounter;
  }

  private set eventCounter(value: number) {
    this.live.eventCounter = value;
  }

  private get contextStore() {
    return this.live.contextStore;
  }

  private set contextStore(value: typeof this.live.contextStore) {
    this.live.contextStore = value;
  }

  private get liveMessageVersion() {
    return this.live.liveMessageVersion;
  }
  // Per-thread monotonic version that ticks every time an agent currently
  // running on that thread emits a message change. `cpk-thread-details`
  // watches this prop and re-fetches `/threads/:id/messages` when it changes,
  // which is how live updates flow into the conversation view without
  // duplicating the runtime's message-shape conversion in the inspector.
  private pointerId: number | null = null;
  private dragStart: Position | null = null;
  private dragOffset: Position = { x: 0, y: 0 };
  private isDragging = false;
  private pointerContext: ContextKey | null = null;
  private isOpen = false;
  private accountCtaMotionPaused = false;
  private draggedDuringInteraction = false;
  private ignoreNextButtonClick = false;
  private selectedMenu: MenuKey = "home";
  private pendingPersistedMenu: MenuKey | null = null;
  private hasOpenedInspector = false;
  private sidebarCollapsed = false;
  private sidebarRailTooltip: { label: string; top: number } | null = null;
  private colorScheme: InspectorColorScheme = "light";
  private hasExplicitColorScheme = false;
  private systemColorSchemeMediaQuery: MediaQueryList | null = null;
  private briefingRestoreMenu: MenuKey | null = null;
  private homeViewedThisOpen = false;

  // ── Intelligence install prompt (Home) ──────────────────────────────────
  //
  // One run id per element lifetime, minted on first copy. The CLI treats the
  // id as one onboarding journey, so a developer who copies twice because they
  // switched editors must not look like two journeys.
  private onboardingRunId: string | null = null;
  /**
   * `copied` reverts after {@link PROMPT_COPY_RESET_MS}; `failed` does not.
   *
   * The instruction only has to survive long enough to be read. Keeping it
   * forever left a button wearing a checkmark and reading as spent, which is
   * the wrong signal for the likeliest reason someone comes back to this card:
   * to copy again. A failed copy is the opposite case — the prompt itself is
   * on screen to be selected by hand, so it stays until acted on.
   */
  private promptCopyState: "idle" | "copied" | "failed" = "idle";
  private promptCopyResetTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Intelligence story (Home) ───────────────────────────────────────────
  //
  // Three beats condensed from the six-phase animation on the Intelligence
  // home page. Runs only while Home is the visible tab AND the document is
  // visible: this is a debugging tool, and a permanent timer behind a closed
  // panel is exactly the kind of thing a developer would find in a profile and
  // rightly complain about.
  private intelStoryBeat = 0;
  private intelStoryUserPinned = false;
  private intelStoryTimer: ReturnType<typeof setTimeout> | null = null;
  private intelStoryReducedMotion: MediaQueryList | null = null;
  private hasResolvedCore = false;
  private settingsOpen = false;
  private readonly lastSelectedMenuByGroup: Record<
    InspectorNavGroupKey,
    MenuKey
  > = {
    home: "home",
    workbench: "threads",
    inspect: "ag-ui-events",
  };
  private lastScrolledAgentNavigationLayout: string | null = null;
  private readonly learning = createLearningState();
  private readonly homeFeatureSetup = createHomeFeatureSetupState();
  private readonly threads = createThreadsState();
  private readonly playground = createPlaygroundState();
  private contextMenuOpen = false;
  private iconRailContextCloseTimer: ReturnType<typeof setTimeout> | null =
    null;
  private layoutMenuOpen = false;
  private dockMode: DockMode = "floating";
  private popOut: PopOutHandle | null = null;
  private inspectorPortal: HTMLDivElement | null = null;
  private previousBodyMargins: { left: string; bottom: string } | null = null;
  private previousHtmlOverflowX: string | null = null;
  private transitionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private bodyTransitionTimeoutIds: Set<ReturnType<typeof setTimeout>> =
    new Set();
  private pendingSelectedContext: string | null = null;
  public autoAttachCore = true;
  private attemptedAutoAttach = false;
  private get _capabilitiesVersion() {
    return this.live.capabilitiesVersion;
  }

  private set _capabilitiesVersion(value: number) {
    this.live.capabilitiesVersion = value;
  }

  private get cachedTools() {
    return this.live.cachedTools;
  }

  private set cachedTools(value: InspectorToolDefinition[]) {
    this.live.cachedTools = value;
  }

  private get toolSignature() {
    return this.live.toolSignature;
  }

  private set toolSignature(value: string) {
    this.live.toolSignature = value;
  }

  private get eventFilterText() {
    return this.live.eventFilterText;
  }

  private set eventFilterText(value: string) {
    this.live.eventFilterText = value;
  }

  private get eventTypeFilter() {
    return this.live.eventTypeFilter;
  }

  private set eventTypeFilter(value: InspectorAgentEventType | "all") {
    this.live.eventTypeFilter = value;
  }

  private get evtColWidths() {
    return this.live.eventColumnWidths;
  }

  private set evtColWidths(value: number[]) {
    this.live.eventColumnWidths = value;
  }

  private get _evtColResize() {
    return this.live.eventColumnResize;
  }

  private set _evtColResize(value: typeof this.live.eventColumnResize) {
    this.live.eventColumnResize = value;
  }

  private announcement: AnnouncementReady | null = null;
  private announcementLoaded = false;
  private announcementPromise: Promise<void> | null = null;
  private readonly announcementTelemetry = new AnnouncementTelemetry();
  private newsSignalArmed = false;
  /** Which signal's beat is in flight, or null between beats. */
  private pulsingSignal: LauncherSignalKey | null = null;
  /**
   * The single pending-beat slot. A beat that cannot land is deferred, never
   * discarded — see `startSignalPulse` for the five reasons it cannot land.
   */
  private pendingPulseSignal: LauncherSignalKey | null = null;
  private pulseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  /**
   * Per-source latches for the error signal, fed from the subscriptions that
   * already exist rather than from the event history: the event buffer is
   * bounded per agent and in total and evicts entries, so counting events
   * could silently lose a live failure.
   */
  private readonly errorSignalArmed: Record<
    InspectorWiringErrorSource,
    boolean
  > = { connection: false, threads: false };
  /** Unread app errors. Cleared when the landing view is read. */
  private readonly eventErrorArmed: Record<InspectorEventErrorSource, boolean> =
    { run: false, tool: false, memory: false };
  /** Latest detail for each event source, retained after that source is read. */
  private readonly eventErrorDetails: Record<
    InspectorEventErrorSource,
    InspectorEventErrorDetails | null
  > = { run: null, tool: null, memory: null };
  private pendingScrollToEventId: string | null = null;
  private pendingScrollToToolCallId: string | null = null;
  /**
   * Whether this outage has already had its beat. Global rather than
   * per-source: a connection failure cascades into thread failures, so one
   * root cause must not produce two nudges. Reset when nothing is red, which
   * is what makes a resolved-then-recurring failure beat again.
   */
  private errorBeatSpent = false;
  /** Per-outage dedup for `oss.inspector.error_signal_viewed`. */
  private readonly errorSignalViewedSources: Set<InspectorErrorSignalSource> =
    new Set();
  /**
   * The signal whose gesture is running its tail — the pill on screen and the
   * sentence in the live region, both of which outlive the beat.
   *
   * Together with `pulsingSignal` this IS the single pending-beat slot, not a
   * second scheduling concept: `startSignalPulse` defers while either is set,
   * so the third deferral reason simply covers a longer beat. Null for the
   * announcement, which has no tail and therefore behaves exactly as before.
   */
  private gestureSignal: LauncherSignalKey | null = null;
  /** Where the running gesture's pill is, or null when it has none. */
  private pillPhase: LauncherPillPhase | null = null;
  /**
   * Which side the pill opens from, or null before the room has been measured.
   * Decided once, at gesture start, and never revisited mid-gesture.
   */
  private pillDirection: LauncherPillDirection | null = null;
  private pillTimeoutId: ReturnType<typeof setTimeout> | null = null;
  /** Hover/focus menu on the closed launcher. */
  private launcherHudOpen = false;
  private launcherHudSide: "left" | "right" = "left";
  private launcherHudCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private launcherHudIntro = false;
  private launcherHudIntroStartTimer: ReturnType<typeof setTimeout> | null =
    null;
  private launcherHudIntroEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** Host-wide deadline that suppresses both the Inspector and its launcher. */
  private inspectorDismissedUntil: number | null = null;
  private inspectorDismissalTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Leaf a HUD row asked for. Consumed by `openInspector` so a red dot on
   * the circle cannot steal "Turn on Threads". Not a public open option.
   */
  private hudLandingMenu: MenuKey | null = null;
  /**
   * Whether this outage's pill actually opened. Per outage rather than per
   * phase, so a second source arming behind the first reports the same answer
   * the reader actually got. Reset with `errorBeatSpent`.
   */
  private pillOutcome: LauncherPillOutcome | null = null;

  get core(): CopilotKitCore | null {
    return this._core;
  }

  set core(value: CopilotKitCore | null) {
    const oldValue = this._core;
    if (oldValue === value) {
      return;
    }

    this.detachFromCore();

    const hadResolvedCore = this.hasResolvedCore;
    this._core = value ?? null;
    if (this._core) {
      this.hasResolvedCore = true;
    }

    if (!hadResolvedCore && this._core) {
      this.resolvePendingPersistedMenu();
    } else if (hadResolvedCore) {
      this.reconcileSelectedMenuVisibility();
    }
    this.requestUpdate("core", oldValue);

    if (this._core) {
      this.attachToCore(this._core);
    }
  }

  private readonly contextState: Record<ContextKey, ContextState> = {
    button: {
      position: { x: EDGE_MARGIN, y: EDGE_MARGIN },
      size: { ...DEFAULT_BUTTON_SIZE },
      anchor: { horizontal: "right", vertical: "top" },
      anchorOffset: { x: EDGE_MARGIN, y: EDGE_MARGIN },
    },
    window: {
      position: { x: EDGE_MARGIN, y: EDGE_MARGIN },
      size: { ...DEFAULT_WINDOW_SIZE },
      anchor: { horizontal: "right", vertical: "top" },
      anchorOffset: { x: EDGE_MARGIN, y: EDGE_MARGIN },
    },
  };

  private hasCustomPosition: Record<ContextKey, boolean> = {
    button: false,
    window: false,
  };

  private resizePointerId: number | null = null;
  private resizeStart: Position | null = null;
  private resizeInitialSize: { width: number; height: number } | null = null;
  private resizeInitialPosition: Position | null = null;
  private resizeEdge: "e" | "w" | "s" | "se" | "sw" = "se";
  private isResizing = false;

  private readonly customTabIcons: Record<string, string> = {
    threads: `<svg class="h-3.5 w-3.5" width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.04167 15C8.29167 15 7.65972 14.7431 7.14583 14.2292C6.63194 13.7153 6.375 13.0972 6.375 12.375C6.375 11.3194 6.80208 10.3646 7.65625 9.51042C8.51042 8.65625 9.57639 8.125 10.8542 7.91667C10.8125 7.41667 10.6875 7.03819 10.4792 6.78125C10.2708 6.52431 9.98611 6.39583 9.625 6.39583C9.20833 6.39583 8.75694 6.56944 8.27083 6.91667C7.78472 7.26389 7.20833 7.83333 6.54167 8.625C5.45833 9.91667 4.66319 10.7569 4.15625 11.1458C3.64931 11.5347 3.10417 11.7292 2.52083 11.7292C1.8125 11.7292 1.21528 11.4653 0.729167 10.9375C0.243056 10.4097 0 9.77083 0 9.02083C0 8.27083 0.163194 7.50347 0.489583 6.71875C0.815972 5.93403 1.36806 4.99306 2.14583 3.89583C2.40972 3.53472 2.60417 3.22917 2.72917 2.97917C2.85417 2.72917 2.91667 2.52778 2.91667 2.375C2.91667 2.27778 2.89931 2.20486 2.86458 2.15625C2.82986 2.10764 2.77778 2.08333 2.70833 2.08333C2.56944 2.08333 2.39583 2.17014 2.1875 2.34375C1.97917 2.51736 1.73611 2.78472 1.45833 3.14583L0 1.66667C0.444444 1.125 0.895833 0.711806 1.35417 0.427083C1.8125 0.142361 2.26389 0 2.70833 0C3.34722 0 3.88889 0.222222 4.33333 0.666667C4.77778 1.11111 5 1.66667 5 2.33333C5 2.73611 4.89583 3.18056 4.6875 3.66667C4.47917 4.15278 4.13194 4.73611 3.64583 5.41667C3.11806 6.16667 2.72569 6.82639 2.46875 7.39583C2.21181 7.96528 2.08333 8.46528 2.08333 8.89583C2.08333 9.13194 2.12153 9.31597 2.19792 9.44792C2.27431 9.57986 2.38194 9.64583 2.52083 9.64583C2.65972 9.64583 2.78125 9.60764 2.88542 9.53125C2.98958 9.45486 3.18056 9.27083 3.45833 8.97917C3.63889 8.78472 3.85417 8.54514 4.10417 8.26042C4.35417 7.97569 4.65972 7.625 5.02083 7.20833C5.89583 6.16667 6.6875 5.42361 7.39583 4.97917C8.10417 4.53472 8.84722 4.3125 9.625 4.3125C10.5556 4.3125 11.3194 4.625 11.9167 5.25C12.5139 5.875 12.8542 6.72917 12.9375 7.8125H15V9.89583H12.9375C12.8264 11.4514 12.4201 12.691 11.7188 13.6146C11.0174 14.5382 10.125 15 9.04167 15ZM9.08333 12.9167C9.52778 12.9167 9.90278 12.6632 10.2083 12.1562C10.5139 11.6493 10.7222 10.9444 10.8333 10.0417C10.1944 10.1944 9.63889 10.4965 9.16667 10.9479C8.69444 11.3993 8.45833 11.8472 8.45833 12.2917C8.45833 12.4861 8.51389 12.6389 8.625 12.75C8.73611 12.8611 8.88889 12.9167 9.08333 12.9167Z" fill="currentColor"/></svg>`,
  };

  private get menuItems(): MenuItem[] {
    const hasFrontendTools = (this._core?.tools?.length ?? 0) > 0;
    const hasCatalog = (this._core?.catalogComponents?.length ?? 0) > 0;
    // Capabilities is the A2UI catalog + tool toggle surface. If the only
    // live data is frontend tools, Frontend Tools already lists them, so
    // showing Capabilities as well is a duplicate leaf.
    const hasCapabilities = hasCatalog;
    return [
      { key: "home", label: "Home", icon: "Home" as LucideIconName },
      {
        key: WHATS_NEW_MENU_KEY,
        label: WHATS_NEW_VIEW_LABEL,
        icon: "Megaphone" as LucideIconName,
      },
      {
        key: "playground",
        label: "Playground",
        icon: "MessageCircle" as LucideIconName,
      },
      {
        key: "ag-ui-events",
        label: "AG-UI Events",
        icon: "Zap" as LucideIconName,
      },
      { key: "agents", label: "Agent", icon: "Bot" as LucideIconName },
      ...(hasFrontendTools
        ? [
            {
              key: "frontend-tools" as const,
              label: "Frontend Tools",
              icon: "Hammer" as LucideIconName,
            },
          ]
        : []),
      ...(hasCapabilities
        ? [
            {
              key: "capabilities" as const,
              label: CAPABILITIES_TAB_LABEL,
              icon: "SlidersHorizontal" as LucideIconName,
            },
          ]
        : []),
      {
        key: "agent-context",
        label: "Context",
        icon: "FileText" as LucideIconName,
      },
      {
        key: "threads",
        label: "Threads",
        icon: "MessageSquare" as LucideIconName,
      },
      {
        key: "memories",
        label: LEARNING_VIEW_LABEL,
        icon: "Brain" as LucideIconName,
      },
    ];
  }

  /** Return only currently visible leaves owned by a group. */
  private getVisibleMenuItemsForGroup(group: InspectorNavGroupKey): MenuItem[] {
    return INSPECTOR_GROUPS[group].flatMap((menuKey) => {
      const item = this.menuItems.find(
        (candidate) => candidate.key === menuKey,
      );
      return item ? [item] : [];
    });
  }

  /** Resolve a group's last visible leaf, falling back to its first leaf. */
  private getMenuForGroup(group: InspectorNavGroupKey): MenuKey {
    const visibleItems = this.getVisibleMenuItemsForGroup(group);
    const rememberedMenu = this.lastSelectedMenuByGroup[group];
    return (
      visibleItems.find((item) => item.key === rememberedMenu)?.key ??
      visibleItems[0]?.key ??
      "home"
    );
  }

  /** Replace a leaf that became hidden with its group's first visible leaf. */
  private reconcileSelectedMenuVisibility(): void {
    if (this.menuItems.some((item) => item.key === this.selectedMenu)) {
      return;
    }

    const group = getGroupForMenu(this.selectedMenu);
    const fallbackMenu = this.getVisibleMenuItemsForGroup(group)[0]?.key;
    this.selectedMenu = fallbackMenu ?? "home";
    this.lastSelectedMenuByGroup[group] = this.selectedMenu;
    this.persistState();
  }

  /** Open a sidebar group at its last currently visible leaf. */
  private handleGroupSelect(group: InspectorNavGroupKey): void {
    this.handleMenuSelect(this.getMenuForGroup(group));
  }

  /** Toggle Settings without replacing or persisting the active legacy leaf. */
  private handleSettingsToggle(): void {
    this.settingsOpen = !this.settingsOpen;
    this.contextMenuOpen = false;
    this.layoutMenuOpen = false;
    this.requestUpdate();
  }

  private getThreadServiceStatus() {
    return getThreadServiceStatus(this._core);
  }

  private areThreadEndpointsAvailable(): boolean {
    return areThreadEndpointsAvailable(this._core);
  }

  private synchronizeThreadCapability(): void {
    const enabled = this.areThreadEndpointsAvailable();
    if (this.threads.threadCapabilityEnabled === enabled) return;

    this.threads.threadCapabilityEnabled = enabled;
    this.threads.threadCapabilityGeneration += 1;

    if (enabled) {
      const core = this.core;
      if (!core) return;

      const threadStores =
        typeof core.getThreadStores === "function"
          ? core.getThreadStores()
          : {};
      for (const [agentId, store] of Object.entries(threadStores)) {
        this.subscribeToThreadStore(agentId, store);
      }
      for (const agent of Object.values(core.agents)) {
        if (agent?.agentId) {
          this.ensureOwnedThreadStore(agent.agentId);
        }
      }
      return;
    }

    this.teardownThreadStoreSubscriptions();
    this.teardownOwnedThreadStores();
    if (
      this.threads.selectedThreadId !==
      this.threads.selectedLocalExampleThreadId
    ) {
      this.threads.selectedThreadId = null;
      this.threads.selectedLocalExampleThreadId = null;
    }
    this.threads.selectedRealThreadIsExplicit = false;
    this.requestUpdate();
  }

  private getActiveThreadsState(): {
    displayThreads: ɵThread[];
    threadsErrorMessage: string | null;
    threadsLoading: boolean;
  } {
    return selectActiveThreadsState(this.threads, this.selectedContext);
  }

  private getThreadsUsageBucket(): ThreadsUsageBucket {
    return getThreadsUsageBucket(this.inspectorMetadataProjection.usage);
  }

  private getThreadsCapacityState():
    | "normal"
    | "warning"
    | "critical"
    | undefined {
    return getThreadsCapacityState(this.inspectorMetadataProjection.usage);
  }

  private getThreadsExpiryBucket(): ThreadsExpiryBucket {
    return getThreadsExpiryBucket(this.inspectorMetadataProjection.usage);
  }

  /** Report only real rows visible in the active, settled Threads view. */
  private hasActiveVisibleThreads(): boolean {
    if (
      this.selectedMenu !== "threads" ||
      this.settingsOpen ||
      !this.areThreadEndpointsAvailable()
    ) {
      return false;
    }
    return hasVisibleSettledRealThreads(this.getActiveThreadsState());
  }

  /** Build the closed common property set shared by all Thread events. */
  private getThreadsTelemetryProps(): InspectorThreadTelemetryProps {
    const threadServiceStatus = this.getThreadServiceStatus();
    return {
      intelligence_status:
        threadServiceStatus === "available"
          ? "intelligence_enabled"
          : threadServiceStatus === "unavailable"
            ? "intelligence_not_enabled"
            : "unknown",
      thread_service_status: threadServiceStatus,
      license_status: this.core?.licenseStatus ?? undefined,
      runtime_mode: this.core?.runtimeMode ?? undefined,
      runtime_url_type: getRuntimeUrlType(this.core?.runtimeUrl),
      telemetry_disabled: false,
      has_threads: this.hasActiveVisibleThreads(),
      usage_bucket: this.getThreadsUsageBucket(),
      expiry_bucket: this.getThreadsExpiryBucket(),
      group_key: "workbench",
      leaf_key: "threads",
    };
  }

  /** Add the frozen CTA leaves and anonymous URL attribution when allowed. */
  private getThreadsCtaTelemetryProps(
    cta: "signup" | "talk_to_engineer",
    ctaSurface: "threads_locked" | "threads_header" | "sidebar_footer",
  ): InspectorThreadTelemetryProps {
    const distinctId = getTelemetryDistinctIdForUrl();
    return {
      ...this.getThreadsTelemetryProps(),
      cta,
      cta_surface: ctaSurface,
      posthog_distinct_id: distinctId ?? undefined,
    };
  }

  private getIntelligenceSignupUrl(): string {
    return this.appendRefParam(INTELLIGENCE_SIGNUP_URL, "cpk-inspector");
  }

  private getTalkToEngineerUrl(): string {
    return this.appendRefParam(TALK_TO_ENGINEER_URL, "cpk-inspector-threads");
  }

  private getThreadsTalkToEngineerUrl(): string {
    return this.appendRefParam(TALK_TO_ENGINEER_URL, "cpk-inspector-threads");
  }

  private getThreadsDocsUrl(): string {
    return this.appendRefParam(THREADS_DOCS_URL, "cpk-inspector-threads");
  }

  private getThreadsIntelligenceSignupUrl(): string {
    return this.appendRefParam(
      INTELLIGENCE_SIGNUP_URL,
      "cpk-inspector-threads",
    );
  }

  private getSelfHostedIntelligenceUrl(): string {
    return this.appendRefParam(
      SELF_HOSTED_INTELLIGENCE_URL,
      "cpk-inspector-threads",
    );
  }

  /** Selects the onboarding path for an enabled runtime with no saved Threads. */
  private getThreadsEmptyOnboardingAction(): Readonly<{
    href: string;
    label: "Sign up for Intelligence" | "Explore self-hosted Intelligence";
  }> {
    return getThreadsEmptyOnboardingAction(
      this.inspectorMetadataProjection.plan?.code,
      {
        signup: this.getThreadsIntelligenceSignupUrl(),
        selfHosted: this.getSelfHostedIntelligenceUrl(),
      },
    );
  }

  private subscribeToThreadStore(agentId: string, store: ɵThreadStore): void {
    subscribeThreadStore(this.threads, agentId, store, {
      endpointsAvailable: () => this.areThreadEndpointsAvailable(),
      reconcileSelection: () => this.autoSelectLatestThread(),
      onThreadsChanged: () => this.scheduleInspectorUsageRefresh(),
      requestUpdate: () => this.requestUpdate(),
    });
  }

  private rebuildFlattenedThreads(): void {
    rebuildFlattenedThreads(this.threads);
    this.scheduleInspectorUsageRefresh();
  }

  private scheduleInspectorUsageRefresh(): void {
    scheduleThreadsUsageRefresh(this.threads, () => {
      const core = this.core;
      if (core && typeof core.refreshInspectorMetadata === "function") {
        void core.refreshInspectorMetadata();
      }
    });
  }

  private clearInspectorUsageRefresh(): void {
    clearThreadsUsageRefresh(this.threads);
  }

  private autoSelectLatestThread(): void {
    if (!this.areThreadEndpointsAvailable()) return;
    const { displayThreads } = this.getActiveThreadsState();
    const previousSelectedThreadId = this.threads.selectedThreadId;

    if (this.threads.requestedThreadId !== null) {
      this.threads.selectedThreadId = this.threads.requestedThreadId;
      this.threads.selectedRealThreadIsExplicit = true;
      if (
        displayThreads.some(
          (thread) => thread.id === this.threads.requestedThreadId,
        )
      ) {
        this.threads.requestedThreadId = null;
      }
      return;
    }

    if (
      this.threads.selectedLocalExampleThreadId !== null &&
      previousSelectedThreadId === this.threads.selectedLocalExampleThreadId &&
      displayThreads.length === 0
    ) {
      this.threads.selectedRealThreadIsExplicit = false;
      return;
    }

    if (this.threads.selectedLocalExampleThreadId !== null) {
      this.threads.exampleTourActive = false;
    }
    this.threads.selectedLocalExampleThreadId = null;
    const explicitSelectedThreadId = this.threads.selectedRealThreadIsExplicit
      ? previousSelectedThreadId
      : null;
    const nextSelectedThreadId = selectVisibleRealThreadId({
      threads: displayThreads,
      selectedThreadId: explicitSelectedThreadId,
    });
    this.threads.selectedThreadId = nextSelectedThreadId;
    this.threads.selectedRealThreadIsExplicit =
      explicitSelectedThreadId !== null &&
      nextSelectedThreadId === explicitSelectedThreadId;
  }

  private teardownThreadStoreSubscriptions(): void {
    teardownThreadSubscriptions(this.threads, () =>
      this.clearInspectorUsageRefresh(),
    );
  }

  private ensureOwnedThreadStore(agentId: string): void {
    ensureOwnedStore(
      this.threads,
      this.core,
      agentId,
      (id, store) => this.subscribeToThreadStore(id, store),
      this.areThreadEndpointsAvailable(),
    );
  }

  private refreshOwnedThreadStore(agentId: string): void {
    refreshOwnedStore(
      this.threads,
      agentId,
      this.areThreadEndpointsAvailable(),
    );
  }

  private cancelThreadRefreshDebounce(): void {
    cancelThreadRefreshDebounce(this.threads);
  }

  // Keep inspector-owned thread stores in sync when the host updates headers
  // at runtime (e.g. a refreshed auth/CSRF token via core.setHeaders). Mirrors
  // useThreads(), which re-dispatches the context whenever core.headers change,
  // so the owned stores' /threads requests stay authorized.
  private updateOwnedThreadStoreHeaders(
    headers: Readonly<Record<string, string>>,
  ): void {
    updateOwnedStoreHeaders(
      this.threads,
      this.core,
      headers,
      this.areThreadEndpointsAvailable(),
    );
  }

  private removeOwnedThreadStore(agentId: string): void {
    removeOwnedStore(this.threads, this.core, agentId);
  }

  private teardownOwnedThreadStores(): void {
    teardownOwnedStores(this.threads, this.core);
  }

  private coreSupportsInspectorMetadata(core: CopilotKitCore): boolean {
    try {
      return "inspectorMetadata" in core;
    } catch {
      return false;
    }
  }

  private readCoreInspectorMetadata(core: CopilotKitCore): unknown {
    if (!this.coreSupportsInspectorMetadata(core)) {
      return undefined;
    }

    try {
      return core.inspectorMetadata;
    } catch {
      return undefined;
    }
  }

  private updateInspectorMetadataProjection(value: unknown): void {
    this.inspectorMetadataValue = value;
    let runtimeLicense: RuntimeLicenseStatus | undefined;
    try {
      runtimeLicense = this._core?.licenseStatus;
    } catch {
      runtimeLicense = undefined;
    }
    this.inspectorMetadataProjection = projectInspectorMetadata(
      value,
      runtimeLicense,
    );
  }

  private attachToCore(core: CopilotKitCore): void {
    this.runtimeStatus = core.runtimeConnectionStatus;
    this.coreProperties = core.properties;
    this.lastCoreError = null;
    this.clearAllEventErrors();
    const supportsInspectorMetadata = this.coreSupportsInspectorMetadata(core);
    this.updateInspectorMetadataProjection(
      this.readCoreInspectorMetadata(core),
    );

    this.coreSubscriber = {
      onRuntimeConnectionStatusChanged: ({ status }) => {
        this.runtimeStatus = status;
        this.updateInspectorMetadataProjection(this.inspectorMetadataValue);
        const threadCapabilityWasEnabled =
          this.threads.threadCapabilityEnabled === true;
        this.synchronizeThreadCapability();
        if (status === "connected") {
          if (!core.telemetryDisabled) {
            ensureTelemetryDistinctId();
            maybeShowDisclosure();
          }
          this.flushAnnouncementTelemetry();
          if (
            threadCapabilityWasEnabled &&
            this.areThreadEndpointsAvailable()
          ) {
            for (const agentId of this.threads.ownedThreadStores.keys()) {
              this.refreshOwnedThreadStore(agentId);
            }
          }
        } else {
          // Clear stale thread data immediately when the server goes away
          this.threads.threadsByAgent.clear();
          this.threads.threads = [];
          this.clearInspectorUsageRefresh();
        }
        this.requestUpdate();
      },
      onPropertiesChanged: ({ properties }) => {
        this.coreProperties = properties;
        this.requestUpdate();
      },
      onHeadersChanged: ({ headers }) => {
        this.updateOwnedThreadStoreHeaders(headers);
        this.requestUpdate();
      },
      ...(supportsInspectorMetadata
        ? {
            onInspectorMetadataChanged: ({ inspectorMetadata }) => {
              if (this._core !== core) {
                return;
              }
              this.updateInspectorMetadataProjection(inspectorMetadata);
              this.requestUpdate();
            },
          }
        : {}),
      onError: ({ code, error, context }) => {
        this.lastCoreError = { code, message: error.message };
        this.armEventErrorFromCode(code, error.message, context);
        this.requestUpdate();
      },
      onAgentsChanged: ({ agents }) => {
        this.processAgentsChanged(agents);
      },
      onAgentRunStarted: ({ agent }) => {
        // Per-thread clones (from useAgent) are not in the agent registry, so
        // onAgentsChanged never fires for them. Subscribe to the running
        // instance here so its AG-UI events reach the event timeline.
        if (agent?.agentId) {
          this.subscribeToAgent(agent);
        }
      },
      onContextChanged: ({ context }) => {
        this.contextStore = normalizeContextStore(context);
        this.requestUpdate();
      },
      onSuggestionsChanged: () => this.requestUpdate(),
      onSuggestionsStartedLoading: () => this.requestUpdate(),
      onSuggestionsFinishedLoading: () => this.requestUpdate(),
      onSuggestionsConfigChanged: () => this.requestUpdate(),
      onThreadStoreRegistered: ({ agentId, store }) => {
        if (!this.areThreadEndpointsAvailable()) return;
        this.subscribeToThreadStore(agentId, store);
        this.requestUpdate();
      },
      onThreadStoreUnregistered: ({ agentId, prevStore }) => {
        const unsub = this.threads.threadStoreSubscriptions.get(agentId);
        if (unsub) {
          unsub();
          this.threads.threadStoreSubscriptions.delete(agentId);
        }
        if (this.threads.ownedThreadStores.get(agentId) === prevStore) {
          this.threads.ownedThreadStores.delete(agentId);
          prevStore.stop();
        }
        this.threads.threadsByAgent.delete(agentId);
        this.threads.threadsErrorByAgent.delete(agentId);
        this.threads.threadsLoadingByAgent.delete(agentId);
        this.rebuildFlattenedThreads();
        this.autoSelectLatestThread();
        this.requestUpdate();
      },
    } satisfies CopilotKitCoreSubscriber;

    this.coreUnsubscribe = core.subscribe(this.coreSubscriber).unsubscribe;
    this.processAgentsChanged(core.agents);

    if (core.runtimeConnectionStatus === "connected") {
      if (!core.telemetryDisabled) {
        ensureTelemetryDistinctId();
        maybeShowDisclosure();
      }
      this.flushAnnouncementTelemetry();
    }

    // Subscribe to any already-registered thread stores. `getThreadStores` was
    // added in the same release as this inspector; guard so consumers still on
    // an older @copilotkit/core don't throw when assigning `inspector.core`.
    const threadStores =
      typeof core.getThreadStores === "function" ? core.getThreadStores() : {};
    if (this.areThreadEndpointsAvailable()) {
      for (const [agentId, store] of Object.entries(threadStores)) {
        this.subscribeToThreadStore(agentId, store);
      }
    }

    // Initialize context from core
    if (core.context) {
      this.contextStore = normalizeContextStore(core.context);
    }

    // NOTE: the memory store is intentionally NOT touched here. Calling
    // `core.getMemoryStore()` lazily creates + `.start()`s the store and opens
    // a realtime connection, so merely attaching the inspector would spin up a
    // memory store + realtime even in apps that never use memory. Instead, the
    // store is created + subscribed on first Memories-tab activation via
    // `ensureMemorySubscription` (user-initiated, acceptable). Attaching the
    // inspector creates nothing.
    //
    // Exception: if the Memories tab is ALREADY the active tab when core is
    // wired (e.g. core attaches after `firstUpdated` restored a persisted
    // `selectedMenu: "memories"`), subscribe now so the live store + realtime
    // status paint instead of the stuck defaults. This preserves INSP-1 (no
    // unconditional subscribe on attach) because it is gated on the active tab,
    // and is safe to call when already subscribed because the Learning state
    // tracks whether the subscription has started.
    if (this.selectedMenu === "memories") {
      this.ensureMemorySubscription();
    }
  }

  /**
   * Lazily subscribes to the singleton memory store the first time the user
   * activates the Memories tab. This is deferred out of `attachToCore` because
   * `core.getMemoryStore()` is what creates + starts the store and opens
   * realtime — doing it on attach would start memory for apps that never use
   * it. Idempotent: repeated tab activations are guarded by Learning state. On
   * an older @copilotkit/core without `getMemoryStore`, records the unsupported
   * state so the teaser can guide an SDK upgrade.
   */
  private ensureMemorySubscription(): void {
    ensureLearningSubscription(this.learning, this._core, {
      projectError: (error) => this.armEventError("memory", error.message),
      requestUpdate: () => this.requestUpdate(),
    });
  }

  /**
   * Runs a semantic recall via the memory store (`core.getMemoryStore().recall`,
   * from B2) and stores ranked results. Guarded by a monotonic sequence token
   * so a stale request cannot overwrite a newer result / Clear / detach. Only
   * reachable from the Intelligence-gated memory view, so it inherits the gate.
   */
  private runRecall(query: string): void {
    runLearningRecall(this.learning, this._core, query, () =>
      this.requestUpdate(),
    );
  }

  /** Clears recall results/section and cancels any in-flight recall. */
  private clearRecall(): void {
    clearLearningRecall(this.learning);
    this.requestUpdate();
  }

  private detachFromCore(): void {
    this.threads.threadCapabilityGeneration += 1;
    this.threads.threadCapabilityEnabled = null;
    if (
      this.threads.selectedThreadId !==
      this.threads.selectedLocalExampleThreadId
    ) {
      this.threads.selectedThreadId = null;
      this.threads.selectedLocalExampleThreadId = null;
    }
    this.threads.selectedRealThreadIsExplicit = false;
    if (this.coreUnsubscribe) {
      this.coreUnsubscribe();
      this.coreUnsubscribe = null;
    }
    resetLearningState(this.learning);
    this.coreSubscriber = null;
    this.runtimeStatus = null;
    this.cancelThreadRefreshDebounce();
    this.inspectorMetadataValue = undefined;
    this.inspectorMetadataProjection = projectInspectorMetadata(
      undefined,
      undefined,
    );
    this.metadataTelemetryFingerprints.clear();
    this.lastCoreError = null;
    this.clearAllEventErrors();
    this.coreProperties = {};
    this.cachedTools = [];
    this.toolSignature = "";
    this.teardownAgentSubscriptions();
    this.teardownPlaygroundAgent();
    this.teardownThreadStoreSubscriptions();
    this.teardownOwnedThreadStores();
  }

  private teardownAgentSubscriptions(): void {
    teardownLiveAgentSubscriptions(this.live);
  }

  private processAgentsChanged(
    agents: Readonly<Record<string, AbstractAgent>>,
  ): void {
    this.synchronizeThreadCapability();
    const seenAgentIds = new Set<string>();

    for (const agent of Object.values(agents)) {
      if (!agent?.agentId) {
        continue;
      }
      seenAgentIds.add(agent.agentId);
      this.subscribeToAgent(agent);
      this.ensureOwnedThreadStore(agent.agentId);
    }

    for (const agentId of Array.from(this.agentSubscriptions.keys())) {
      if (!seenAgentIds.has(agentId)) {
        this.unsubscribeFromAgent(agentId);
        this.agentEvents.delete(agentId);
        this.agentMessages.delete(agentId);
        this.agentStates.delete(agentId);
        // Do NOT remove owned thread stores here — they are independent of
        // whether the agent appears in core.agents (published cores discover
        // agents asynchronously so agents may be empty on first fire). Stores
        // are torn down in teardownOwnedThreadStores() when the core detaches.
      }
    }

    this.updateContextOptions(seenAgentIds);
    this.refreshToolsSnapshot();
    this.requestUpdate();
  }

  private refreshToolsSnapshot(): void {
    if (refreshLiveToolsSnapshot(this.live, this._core)) this.requestUpdate();
  }

  private tryAutoAttachCore(): void {
    if (
      this.attemptedAutoAttach ||
      this._core ||
      !this.autoAttachCore ||
      typeof window === "undefined"
    ) {
      return;
    }

    this.attemptedAutoAttach = true;

    const globalWindow = window as unknown as Record<string, unknown>;
    const globalCandidates: Array<unknown> = [
      // Common app-level globals used during development
      globalWindow.__COPILOTKIT_CORE__,
      (globalWindow.copilotkit as { core?: unknown } | undefined)?.core,
      globalWindow.copilotkitCore,
    ];

    const foundCore = globalCandidates.find(
      (candidate): candidate is CopilotKitCore =>
        !!candidate && typeof candidate === "object",
    );

    if (foundCore) {
      this.core = foundCore;
    }
  }

  private subscribeToAgent(agent: AbstractAgent): void {
    subscribeLiveAgent(this.live, agent, {
      recordEvent: (agentId, type, payload) =>
        this.recordAgentEvent(agentId, type, payload),
      requestUpdate: () => this.requestUpdate(),
      refreshTools: () => this.refreshToolsSnapshot(),
      refreshThreads: (agentId) => this.refreshOwnedThreadStore(agentId),
      canRefreshThreads: () => this.areThreadEndpointsAvailable(),
    });
  }

  private recordAgentEvent(
    agentId: string,
    type: InspectorAgentEventType,
    payload: unknown,
  ): void {
    recordLiveEvent(this.live, agentId, type, payload);
    this.refreshToolsSnapshot();
    this.requestUpdate();
  }

  private unsubscribeFromAgent(agentId: string): void {
    unsubscribeLiveAgent(this.live, agentId);
  }

  private updateContextOptions(agentIds: Set<string>): void {
    let selectedContextChanged = false;
    const nextOptions: Array<{ key: string; label: string }> = [
      { key: "all-agents", label: "All Agents" },
      ...Array.from(agentIds)
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ key: id, label: id })),
    ];

    const optionsChanged =
      this.contextOptions.length !== nextOptions.length ||
      this.contextOptions.some(
        (option, index) => option.key !== nextOptions[index]?.key,
      );

    if (optionsChanged) {
      this.contextOptions = nextOptions;
    }

    const pendingContext = this.pendingSelectedContext;
    if (pendingContext) {
      const isPendingAvailable =
        pendingContext === "all-agents" || agentIds.has(pendingContext);
      // Only restore a specific-agent selection when there is exactly one
      // agent registered. With multiple agents, fall back to "all-agents" so
      // events from any agent are visible regardless of what was persisted.
      const shouldRestore =
        isPendingAvailable &&
        (pendingContext === "all-agents" || agentIds.size === 1);
      if (shouldRestore) {
        if (this.selectedContext !== pendingContext) {
          this.selectedContext = pendingContext;
          selectedContextChanged = true;
          this.expandedRows.clear();
        }
        this.pendingSelectedContext = null;
      } else if (agentIds.size > 0) {
        // Persisted selection is unavailable or inappropriate for multiple
        // agents — reset to "all-agents" so nothing is silently filtered.
        if (this.selectedContext !== "all-agents") {
          this.selectedContext = "all-agents";
          selectedContextChanged = true;
          this.expandedRows.clear();
        }
        this.pendingSelectedContext = null;
      }
    }

    const hasSelectedContext = nextOptions.some(
      (option) => option.key === this.selectedContext,
    );

    if (!hasSelectedContext && this.pendingSelectedContext === null) {
      // When there is exactly one agent, auto-select it so the view is
      // immediately focused. When multiple agents are registered (e.g. "default"
      // + "openai"), keep "all-agents" so events from any agent are visible.
      let nextSelected: string = "all-agents";

      if (agentIds.size === 1) {
        nextSelected = Array.from(agentIds)[0]!;
      }

      if (this.selectedContext !== nextSelected) {
        this.selectedContext = nextSelected;
        selectedContextChanged = true;
        this.expandedRows.clear();
        this.persistState();
      }
    }

    if (selectedContextChanged) {
      this.autoSelectLatestThread();
    }
  }

  private focusThread(options: InspectorOpenOptions): void {
    if (!options.threadId) return;
    this.pendingPersistedMenu = null;
    this.selectedMenu = "threads";
    this.settingsOpen = false;
    this.lastSelectedMenuByGroup.workbench = "threads";
    this.contextMenuOpen = false;
    this.layoutMenuOpen = false;
    this.threads.selectedLocalExampleThreadId = null;
    this.threads.exampleTourActive = false;
    this.selectedContext =
      options.agentId &&
      this.contextOptions.some((option) => option.key === options.agentId)
        ? options.agentId
        : "all-agents";
    this.threads.requestedThreadId = options.threadId;
    this.threads.selectedThreadId = options.threadId;
    this.threads.selectedRealThreadIsExplicit = true;
    this.threads.focusedThreadMessageId = options.messageId ?? null;
    this.threads.threadFocusRequestId += 1;

    const { displayThreads } = this.getActiveThreadsState();
    if (displayThreads.some((thread) => thread.id === options.threadId)) {
      this.threads.requestedThreadId = null;
    }

    this.persistState();
    this.requestUpdate();
  }

  private getLatestStateForAgent(agentId: string): SanitizedValue | null {
    return latestStateForAgent(this.live, agentId);
  }

  private getLiveAgentMessagesForThread(thread: ɵThread): InspectorMessage[] {
    return liveAgentMessagesForThread(
      this.live,
      thread,
      this._core && typeof this._core.getAgent === "function"
        ? (agentId) => this._core?.getAgent(agentId)
        : undefined,
    );
  }

  private getAgentStats(agentId: string): {
    totalEvents: number;
    lastActivity: number | null;
    messages: number;
    toolCalls: number;
    errors: number;
  } {
    return agentStats(this.live, agentId);
  }

  private renderToolCallDetails(toolCalls: InspectorToolCall[]) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return nothing;
    }

    const toolError = this.eventErrorDetails.tool;

    return html`
      <div class="mt-2 space-y-2">
        ${toolCalls.map((call, index) => {
          const functionName =
            call.function?.name ?? call.toolName ?? "Unknown function";
          const callId =
            typeof call?.id === "string" ? call.id : `tool-call-${index + 1}`;
          const argsString = this.formatToolCallArguments(
            call.function?.arguments ?? call.arguments,
          );
          const isFailedCall =
            toolError?.toolCallId !== undefined &&
            toolError.toolCallId === callId;
          return html`
            <div
              class=${
                isFailedCall
                  ? "rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-gray-900"
                  : "rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700"
              }
              data-cpk-failed-tool-call=${isFailedCall ? callId : undefined}
            >
              <div
                class="flex flex-wrap items-center justify-between gap-1 font-medium text-gray-900"
              >
                <span>${functionName}${isFailedCall ? " failed" : ""}</span>
                <span class="text-[10px] text-gray-600">ID: ${callId}</span>
              </div>
              ${
                isFailedCall && toolError?.message
                  ? html`<p
                    class="mt-2 break-words leading-relaxed text-gray-800"
                  >
                    ${toolError.message}
                  </p>`
                  : nothing
              }
              ${
                argsString
                  ? html`<div class="mt-2">
                    ${renderJsonValue(
                      coerceJsonValue(
                        call.function?.arguments ?? call.arguments,
                      ),
                    )}
                  </div>`
                  : nothing
              }
            </div>
          `;
        })}
      </div>
    `;
  }

  private formatToolCallArguments(args: unknown): string | null {
    if (args === undefined || args === null || args === "") {
      return null;
    }

    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return args;
      }
    }

    if (typeof args === "object") {
      try {
        return JSON.stringify(args, null, 2);
      } catch {
        return String(args);
      }
    }

    return String(args);
  }

  /** Prefer the window that owns the UI: the popup while popped out. */
  private getClipboard(event?: Event): Clipboard | undefined {
    if (this.isPoppedOut) {
      const popped = this.popOut?.win.navigator.clipboard;
      if (popped) {
        return popped;
      }
    }
    const view = event && "view" in event ? (event as UIEvent).view : null;
    const viewClipboard = view?.navigator.clipboard;
    if (viewClipboard) {
      return viewClipboard;
    }
    // Clipboard is required on Navigator in lib.dom, but missing in some runtimes.
    if (typeof navigator !== "undefined" && "clipboard" in navigator) {
      return navigator.clipboard;
    }
    return undefined;
  }

  static styles = [
    unsafeCSS(tailwindStyles),
    homeViewStyles,
    announcementViewStyles,
    learningViewStyles,
    playgroundViewStyles,
    threadsViewStyles,
    css`
      :host {
        --cpk-inspector-shell-radius: 5px;
        --cpk-inspector-surface-dark: #111319;
        --cpk-json-key: #3d408f;
        --cpk-json-str: #0b6b4c;
        --cpk-json-num: #8a5900;
        --cpk-json-bool: #c0333a;
        --cpk-json-nil: #57575b;
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483646;
        display: block;
        will-change: transform;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      }

      :host([data-color-scheme="dark"]),
      .inspector-window[data-color-scheme="dark"] {
        --cpk-json-key: #bec2ff;
        --cpk-json-str: #85ecce;
        --cpk-json-num: #ffac4d;
        --cpk-json-bool: #fa5f67;
        --cpk-json-nil: #afafb7;
        --cpk-json-background: #111319;
        --cpk-json-color: #f3f4f8;
        --cpk-json-border: 1px solid #343742;
        --cpk-copy-border: #454956;
        --cpk-copy-background: #1d2028;
        --cpk-copy-color: #d5d7df;
        --cpk-copy-hover-background: #292d37;
        --cpk-copy-hover-color: #ffffff;
      }

      .rounded-sm {
        border-radius: 3px;
      }

      .rounded-md {
        border-radius: 7px;
      }

      .rounded-lg {
        border-radius: 10px;
      }

      .rounded-xl {
        border-radius: 14px;
      }

      :host([data-docked="true"]) {
        top: 0;
        left: 0;
        bottom: 0;
        transform: none !important;
        will-change: auto;
      }

      :host([data-transitioning="true"]) {
        transition: transform 300ms ease;
      }

      .console-button-wrapper {
        position: relative;
        display: inline-flex;
        /* The launcher's surface and edge, shared by the button and the pill so
           the two cannot drift apart. A dark grey rather than near-black: the
           launcher sits on a customer's page, and 1,5,7 against white is a
           harder edge than this surface needs. */
        --cpk-launcher-face: rgba(24, 28, 31, 0.95);
        --cpk-launcher-face-solid: rgb(24, 28, 31);
        --cpk-launcher-edge: rgba(190, 194, 255, 0.25);
        /* The launcher's own size, exposed so the signal dot can be placed
           against the OUTER rim with a length rather than a percentage.
           Percentages resolve against the padding box, which the 1px border
           insets, and the dot would land inside the rim.

           Declared on the wrapper rather than on the button so the pill, which
           is the button's sibling, can clear the mark by the same length. */
        --cpk-launcher-size: clamp(
          ${LAUNCHER_MIN_SIZE}px,
          7vw,
          ${LAUNCHER_MAX_SIZE}px
        );
      }

      .console-button {
        width: var(--cpk-launcher-size);
        height: var(--cpk-launcher-size);
        /* Keep the 1px border inside the declared outer size. */
        box-sizing: border-box;
        transition:
          transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
          scale 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
          background-color 200ms ease,
          border-color 200ms ease,
          box-shadow 200ms ease,
          opacity 160ms ease;
      }

      .console-button[data-dragging="true"] {
        transition: opacity 160ms ease;
      }

      .inspector-window[data-transitioning="true"] {
        transition:
          width 300ms ease,
          height 300ms ease;
      }

      .inspector-window[data-docked="true"] {
        border-radius: 0 !important;
        box-shadow: none !important;
        top: 0 !important;
        left: 0 !important;
        bottom: 0 !important;
        height: auto !important;
        max-height: none !important;
      }

      .resize-handle {
        touch-action: none;
        user-select: none;
        z-index: 60;
        background: transparent;
      }

      .edge-resize-handle {
        position: absolute;
        z-index: 55;
        touch-action: none;
        user-select: none;
        background: transparent;
      }

      .edge-resize-handle-e {
        top: 48px;
        right: 0;
        width: 8px;
        height: calc(100% - 48px);
        cursor: ew-resize;
      }

      .edge-resize-handle-w {
        top: 48px;
        left: 0;
        width: 8px;
        height: calc(100% - 48px);
        cursor: ew-resize;
      }

      .edge-resize-handle-s {
        left: 0;
        bottom: 0;
        width: 100%;
        height: 8px;
        cursor: ns-resize;
      }

      .dock-resize-handle {
        position: absolute;
        top: 0;
        right: 0;
        width: 10px;
        height: 100%;
        cursor: ew-resize;
        touch-action: none;
        z-index: 50;
        background: transparent;
      }

      .tooltip-target {
        position: relative;
      }

      .tooltip-target::after {
        content: attr(data-tooltip);
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%) translateY(-4px);
        white-space: nowrap;
        background: rgba(1, 5, 7, 0.95);
        color: white;
        padding: 4px 8px;
        border-radius: 7px;
        font-size: 10px;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        line-height: 1.2;
        box-shadow: 0 4px 10px rgba(1, 5, 7, 0.18);
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 120ms ease,
          transform 120ms ease;
        z-index: 4000;
      }

      .tooltip-target:hover::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* ── Circle chevron (Frontend Tools + Context) ──────────────────── */
      .cpk-chevron-circle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: #f0f0f4;
        color: #68686e;
        flex-shrink: 0;
        transition: transform 0.2s;
      }
      .cpk-chevron-circle svg {
        width: 14px !important;
        height: 14px !important;
      }
      .cpk-chevron-circle--open {
        transform: rotate(180deg);
      }

      /* ── Inline copy button ─────────────────────────────────────────── */
      .cpk-copy-btn {
        flex-shrink: 0;
        --cpk-copy-font-size: 0.625rem;
        --cpk-copy-font-weight: 500;
        --cpk-copy-color: #57575b;
        --cpk-copy-background: #ffffff;
        --cpk-copy-border: #dbdbe5;
        --cpk-copy-hover-background: #f0f0f4;
        --cpk-copy-hover-border: #afafb7;
        --cpk-copy-padding: 2px 8px;
        --cpk-copy-radius: 5px;
      }

      .inspector-window[data-color-scheme="dark"] .cpk-copy-btn {
        --cpk-copy-background: #191c24;
        --cpk-copy-border: #3a3d49;
        --cpk-copy-color: #f3f4f8;
        --cpk-copy-hover-background: #20232d;
        --cpk-copy-hover-border: #57575b;
      }

      .inspector-sidebar[data-icon-rail="true"]
        .inspector-sidebar-agent-scope
        [data-context-dropdown-root="true"]
        > div {
        left: 100%;
        margin-inline-start: 8px;
      }

      .inspector-icon-rail-menu {
        transform-origin: left center;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateX(-8px) scale(0.96);
        transition:
          opacity 180ms ease,
          transform 180ms ease,
          visibility 180ms ease;
      }

      .inspector-icon-rail-menu[data-open="true"] {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translateX(0) scale(1);
      }

      @media (prefers-reduced-motion: reduce) {
        .inspector-icon-rail-menu {
          transition: none;
        }
      }

      .inspector-sidebar[data-icon-rail="true"]
        .inspector-sidebar-agent-scope
        [data-context-dropdown-root="true"]
        > div::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inset-inline-end: 100%;
        width: 12px;
      }

      .cpk-section-header {
        background: #e8edf5;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        padding: 10px 16px;
      }
      .inspector-window[data-color-scheme="dark"] .cpk-section-header {
        border-bottom-color: #3a3d49;
      }
      .cpk-section-header h4 {
        font-size: 11px;
        font-weight: 600;
        color: #181c1f;
        margin: 0;
      }

      /* Inputs/selects inside the lavender header need an explicit white bg */
      .cpk-section-header input,
      .cpk-section-header select {
        background-color: #ffffff !important;
        box-shadow: none !important;
      }
      .cpk-section-header select {
        padding-right: 24px !important;
      }
      /* Events table column headers */
      table thead th {
        font-weight: 600 !important;
      }

      /* ── Brand typography ────────────────────────────────────────── */
      /* Override Tailwind font-mono stack → Spline Sans Mono */
      .font-mono,
      pre,
      code {
        font-family:
          "Spline Sans Mono", ui-monospace, "Cascadia Code", monospace;
      }

      /* ── Floating button ─────────────────────────────────────────── */
      .console-button {
        background-color: var(--cpk-launcher-face) !important;
        border-color: var(--cpk-launcher-edge) !important;
        /* One hairline, not two. The border above is it; a second ring used to
           sit 1px outside as a box-shadow and hardcoded the lilac instead of
           reading the --cpk-launcher-edge token, so it could not follow it.
           What replaces it is a one-pixel light edge along the top, which is
           what keeps the face from reading flat without drawing a frame.

           The border is not decoration: the face is #181C1F, which against a
           dark host page (GitHub dark 1.10:1, Tailwind slate-900 1.04:1) is
           indistinguishable from the page. It is the only thing that gives the
           launcher an outline there, so it stays. */
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.07),
          0 4px 14px rgba(1, 5, 7, 0.28) !important;
        /* Promotes the launcher to its own compositing layer, which the
           backdrop-filter this replaces used to do as a side effect. Without
           a layer the hover scale re-rasterises the mark every frame and it
           visibly jitters; with one, the compositor scales it as a texture. */
        will-change: transform;
      }
      .console-button:hover {
        background-color: var(--cpk-launcher-face-solid) !important;
        border-color: rgba(190, 194, 255, 0.45) !important;
        transform: scale(1.05);
      }
      .console-button:focus-visible {
        outline-color: #bec2ff !important;
      }

      /* ── Launcher signal: water ripple + internal wash + dot ────── */
      /*
       * Two rings leave the rim in sequence, like ripples spreading from a
       * drop's point of impact. They share one keyframe but the second begins
       * 180ms later, so the first is already farther from the source.
       *
       * ONLY opacity and transform animate. This component is permanently
       * mounted on top of a customer's application, so animating anything
       * that forces a repaint every frame is not acceptable.
       */
      .console-button[data-cpk-signal] {
        isolation: isolate;
      }

      /*
       * The mark sits above the ripples. Both ring layers are absolutely
       * positioned, so without a stacking position of its own the mark — an
       * ordinary in-flow child — would paint under them. Keeping the centre
       * readable is the reason the motion begins at the rim.
       */
      .cpk-launcher-mark {
        position: relative;
        z-index: 2;
        width: auto;
        height: calc(var(--cpk-launcher-size) / 1.8);
      }

      .console-button[data-cpk-signal]::before,
      .console-button[data-cpk-signal]::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid
          color-mix(in srgb, var(--cpk-launcher-signal) 68%, transparent);
        box-shadow: 0 0 8px
          color-mix(in srgb, var(--cpk-launcher-signal) 38%, transparent);
        pointer-events: none;
        opacity: 0;
        transform: scale(1);
      }

      .cpk-launcher-signal-wash {
        position: absolute;
        inset: 0;
        z-index: 1;
        overflow: hidden;
        border-radius: 50%;
        pointer-events: none;
        opacity: 0;
        background: radial-gradient(
          circle at 50% 50%,
          transparent 26%,
          color-mix(in srgb, var(--cpk-launcher-signal) 78%, transparent) 63%,
          color-mix(in srgb, var(--cpk-launcher-signal) 30%, transparent) 84%,
          transparent 100%
        );
      }

      @keyframes cpk-launcher-ripple {
        0% {
          opacity: 0.95;
          transform: scale(1);
        }
        100% {
          opacity: 0;
          transform: scale(1.5);
        }
      }

      @keyframes cpk-launcher-wash {
        0%,
        100% {
          opacity: 0;
        }
        45% {
          opacity: 1;
        }
      }

      /* Both ripples finish inside the existing one-beat pulse window. */
      .console-button[data-cpk-signal-pulsing="true"]::before,
      .console-button[data-cpk-signal-pulsing="true"]::after {
        animation: cpk-launcher-ripple calc(var(--cpk-launcher-cadence) - 180ms)
          cubic-bezier(0.16, 1, 0.3, 1) 1 forwards;
      }
      .console-button[data-cpk-signal-pulsing="true"]::after {
        animation-delay: 180ms;
      }
      .console-button[data-cpk-signal-pulsing="true"]
        .cpk-launcher-signal-wash {
        animation: cpk-launcher-wash var(--cpk-launcher-cadence) ease-in-out 1
          both;
      }

      /*
       * The dot's centre sits exactly ON the button's outer rim at 45°, where
       * 0.35355 is 0.5 x cos45. Lengths rather than percentage offsets:
       * percentages resolve against the padding box, which the border insets,
       * and the dot would land a pixel inside the rim.
       */
      .cpk-launcher-signal-dot {
        position: absolute;
        z-index: 3;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%)
          translate(
            calc(var(--cpk-launcher-size) * 0.35355),
            calc(var(--cpk-launcher-size) * -0.35355)
          );
        width: 19%;
        height: 19%;
        border-radius: 50%;
        /* Lit from the upper left and shaded at the lower right, so the dot
           reads as a lens rather than a flat disc. Both stops are derived from
           the signal colour, so a new tone needs no new values. */
        background: radial-gradient(
          circle at 32% 28%,
          color-mix(in srgb, var(--cpk-launcher-signal), white 40%) 0%,
          var(--cpk-launcher-signal) 60%,
          color-mix(in srgb, var(--cpk-launcher-signal), black 20%) 100%
        );
        /* Replaces an opaque 1.5px collar in the launcher's own face. That
           collar was 21% of the dot's footprint, and because the dot's centre
           sits *on* the rim, its outer half painted a hard dark crescent onto
           the host page rather than onto the launcher. A hairline plus a soft
           drop does the same separating job without the hard edge. */
        box-shadow:
          0 0 0 0.5px rgba(1, 5, 7, 0.4),
          0 1px 2.5px rgba(1, 5, 7, 0.5);
      }

      /* ── Launcher pill: the launcher opens sideways and says what ─── */
      /*
       * The pill is laid out at its FULL width from the first frame and
       * revealed by animating a rectangular clip. Nothing is scaled and
       * nothing is resized.
       *
       * That is not a stylistic choice. This component is permanently mounted
       * on top of a customer's application, so no property that forces a
       * layout on every frame is acceptable — and animating "width" does
       * exactly that, sixty times a second, on someone else's page. A clip
       * leaves the element's geometry constant and changes only the visible
       * region, which the compositor handles. Animating a horizontal scale
       * was the other candidate and squashes the mark itself, not merely the
       * rounded end, so the logo would need counter-scaling and the dot and
       * halo would become ellipses.
       *
       * The launcher's own face and border are repeated here so the two form
       * one capsule: the button paints last and therefore on top, with no
       * z-index needed. The mark's own ring and shadow are deliberately left
       * alone for the whole gesture — the circle's outline staying visible
       * inside the open pill was looked at against the alternative and kept.
       *
       * A column, not a row: the pill carries a heading and a subline stacked,
       * centred against a height that does not change. "justify-content"
       * centres the pair vertically and "align-items" keeps both lines flush
       * left, so the pill never grows taller than the launcher it opens from.
       */
      .cpk-launcher-pill {
        position: absolute;
        top: 50%;
        margin-top: calc(var(--cpk-launcher-size) / -2);
        height: var(--cpk-launcher-size);
        display: inline-flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        gap: 1px;
        box-sizing: border-box;
        border-radius: 999px;
        border: 1px solid var(--cpk-launcher-edge);
        background: var(--cpk-launcher-face);
        color: #ffffff;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
      }

      /* The failure class, word-identical to the panel's own wording. */
      .cpk-launcher-pill__heading {
        font-size: 12px;
        font-weight: 600;
        line-height: 1.2;
      }

      /*
       * The one line of copy in this feature that exists nowhere else in the
       * product. The heading above is word-identical to the panel, which is
       * the standing rule; this line is a deliberate, owner-approved exception
       * to it, because the pill is now clickable and has to say so.
       *
       * It is NOT spoken. A screen-reader user cannot act on an instruction
       * delivered through an announcement, and it would double the spoken
       * length — so the live region carries the failure class alone.
       */
      .cpk-launcher-pill__subline {
        font-size: 10.5px;
        font-weight: 500;
        line-height: 1.2;
        opacity: 0.72;
      }

      /*
       * Two directions, one animation with the inset on the other side. The
       * padding on the launcher's side clears the mark, so the words never sit
       * under it. The text-side padding is derived from the capsule's radius
       * (half the launcher size), NOT a bare literal: padding is measured from
       * the bounding box, but the first half-height of that side is the rounded
       * cap. Half the size lands the text exactly where the cap ends and the
       * straight edge begins. A literal 14px put it 16px inside the curve at the
       * production launcher size, which is itself a clamp on the viewport.
       */
      .cpk-launcher-pill[data-cpk-pill-direction="left"] {
        right: 0;
        padding: 0 calc(var(--cpk-launcher-size) + 12px) 0
          calc(var(--cpk-launcher-size) / 2);
        clip-path: inset(0 0 0 calc(100% - var(--cpk-launcher-size)));
      }
      .cpk-launcher-pill[data-cpk-pill-direction="right"] {
        left: 0;
        padding: 0 calc(var(--cpk-launcher-size) / 2) 0
          calc(var(--cpk-launcher-size) + 12px);
        clip-path: inset(0 calc(100% - var(--cpk-launcher-size)) 0 0);
      }

      /*
       * "round" on both stops, so the revealing edge is the capsule's own
       * rounded end travelling sideways rather than a straight vertical line
       * wiping across it. An unrounded inset reads as a wipe; this reads as an
       * opening. It adds no animated property: the clip is still the clip.
       */
      @keyframes cpk-launcher-pill-left {
        0% {
          opacity: 0;
          clip-path: inset(
            0 0 0 calc(100% - var(--cpk-launcher-size)) round 999px
          );
        }
        100% {
          opacity: 1;
          clip-path: inset(0 0 0 0 round 999px);
        }
      }

      @keyframes cpk-launcher-pill-right {
        0% {
          opacity: 0;
          clip-path: inset(
            0 calc(100% - var(--cpk-launcher-size)) 0 0 round 999px
          );
        }
        100% {
          opacity: 1;
          clip-path: inset(0 0 0 0 round 999px);
        }
      }

      /*
       * The pill takes the pointer exactly while it is on screen, so the
       * instruction it now carries is honest: a click on it opens the
       * Inspector, the same action as pressing the mark. During the beat the
       * clip covers only the mark itself, and a click target nobody can see
       * over someone else's page is not something to ship — so the base rule
       * keeps "pointer-events: none" and only the three visible phases take it
       * back.
       * The button paints last and therefore wins the pointer where the two
       * overlap, so dragging the launcher is unaffected throughout.
       */
      .cpk-launcher-pill[data-cpk-pill-phase="opening"],
      .cpk-launcher-pill[data-cpk-pill-phase="holding"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
        pointer-events: auto;
        cursor: pointer;
      }

      /* Closing is the same animation played backwards, so the two phases can
         never drift apart. */
      .cpk-launcher-pill[data-cpk-pill-phase="opening"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
        animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
        animation-iteration-count: 1;
        animation-fill-mode: forwards;
      }
      .cpk-launcher-pill[data-cpk-pill-phase="opening"] {
        animation-duration: var(--cpk-launcher-pill-open);
      }
      .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
        animation-duration: var(--cpk-launcher-pill-close);
        animation-direction: reverse;
      }
      .cpk-launcher-pill[data-cpk-pill-phase="opening"][data-cpk-pill-direction="left"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"][data-cpk-pill-direction="left"] {
        animation-name: cpk-launcher-pill-left;
      }
      .cpk-launcher-pill[data-cpk-pill-phase="opening"][data-cpk-pill-direction="right"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"][data-cpk-pill-direction="right"] {
        animation-name: cpk-launcher-pill-right;
      }

      /* The hold is the end state of the reveal, held. */
      .cpk-launcher-pill[data-cpk-pill-phase="holding"] {
        opacity: 1;
        clip-path: inset(0 0 0 0);
      }

      /*
       * Reduced motion: the halo is held statically rather than animated, so
       * the information arrives without the movement.
       */
      @media (prefers-reduced-motion: reduce) {
        /*
         * The pill is shown by opacity alone, with no clip animation and the
         * same hold. The instruction is to reduce motion, not to withhold
         * information, and this reader needs the label as much as anyone.
         */
        .cpk-launcher-pill[data-cpk-pill-phase="opening"],
        .cpk-launcher-pill[data-cpk-pill-phase="holding"],
        .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
          animation: none !important;
          opacity: 1;
          clip-path: inset(0 0 0 0);
        }
        .cpk-launcher-signal-wash {
          opacity: 0.85;
        }
        .console-button[data-cpk-signal]::before {
          opacity: 0.5;
        }
        .console-button[data-cpk-signal]::after {
          opacity: 0;
        }
        .console-button[data-cpk-signal-pulsing="true"]::before,
        .console-button[data-cpk-signal-pulsing="true"]::after {
          animation: none !important;
        }
        .console-button[data-cpk-signal-pulsing="true"]
          .cpk-launcher-signal-wash {
          animation: none !important;
        }
        .console-button {
          transition: opacity 160ms ease;
        }
        .console-button:hover {
          transform: none;
        }
      }

      /* ── Launcher HUD: hover menu, quieter than the error island ── */
      .console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-hud {
        pointer-events: auto;
        opacity: 1;
        transform: none;
        visibility: visible;
      }

      .cpk-launcher-hud {
        --hud-fill: var(--cpk-inspector-surface-dark);
        --hud-line: rgb(190 194 255 / 0.38);
        --hud-accent: #b8adf5;
        --hud-accent-soft: rgb(184 173 245 / 0.13);
        --hud-hover-fill: #252231;
        --hud-blur: blur(12px) saturate(1.2);
        --hud-card-gap: 8px;
        --hud-dismiss-day-height: 32px;
        position: absolute;
        z-index: 4;
        width: 258px;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition:
          opacity 160ms ease,
          transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }

      .cpk-launcher-hud[data-cpk-hud-vertical="top"] {
        top: 0;
        bottom: auto;
      }

      .cpk-launcher-hud[data-cpk-hud-vertical="bottom"] {
        top: auto;
        bottom: 0;
      }

      .cpk-launcher-hud[data-cpk-hud-side="left"] {
        right: 100%;
        left: auto;
        padding-right: 14px;
        transform: translateX(8px);
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"] {
        left: 100%;
        right: auto;
        padding-left: 14px;
        transform: translateX(-8px);
      }

      .console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-hud {
        transform: none;
      }

      .cpk-launcher-hud__card {
        position: relative;
        display: grid;
        width: 244px;
        gap: var(--hud-card-gap);
        color: #fff;
      }

      .cpk-launcher-hud[data-color-scheme="light"] {
        --hud-fill: #fff;
        --hud-line: #ddd6f4;
        --hud-accent: #6757b0;
        --hud-accent-soft: #f1edff;
        --hud-hover-fill: #f1edff;
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__card {
        color: #010507;
      }

      .cpk-launcher-hud__arrow {
        position: absolute;
        top: calc(var(--cpk-launcher-size) / 2);
        z-index: 2;
        width: 10px;
        height: 10px;
        border: 0;
        background: var(--hud-fill);
        transform: rotate(45deg);
        transition: background 120ms ease;
      }

      .cpk-launcher-hud[data-cpk-hud-side="left"] .cpk-launcher-hud__arrow {
        right: 9px;
        border-top: 1px solid var(--hud-line);
        border-right: 1px solid var(--hud-line);
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"] .cpk-launcher-hud__arrow {
        left: 9px;
        border-bottom: 1px solid var(--hud-line);
        border-left: 1px solid var(--hud-line);
      }

      .cpk-launcher-hud[data-cpk-hud-vertical="top"] .cpk-launcher-hud__arrow {
        top: calc(var(--cpk-launcher-size) / 2 - 5px);
      }

      .cpk-launcher-hud[data-cpk-hud-vertical="bottom"]
        .cpk-launcher-hud__arrow {
        top: auto;
        bottom: calc(var(--cpk-launcher-size) / 2 - 5px);
      }

      /* A bottom-anchored HUD can end with the narrower dismissal bubble.
         Keep the pointer attached to the full-width feature panel instead of
         letting it float in the empty space beside that final action. */
      .cpk-launcher-hud[data-cpk-hud-vertical="bottom"]:has(
          .cpk-launcher-hud__dismiss-day
        )
        .cpk-launcher-hud__arrow {
        bottom: calc(
          var(--hud-dismiss-day-height) + var(--hud-card-gap) + 2px
        );
      }

      .cpk-launcher-hud__list {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .cpk-launcher-hud__masthead {
        position: relative;
        z-index: 1;
        margin-top: 6px;
        padding: 0;
        border: 1px solid var(--hud-line);
        border-radius: var(--cpk-inspector-shell-radius);
        background: var(--hud-fill);
        backdrop-filter: var(--hud-blur);
        -webkit-backdrop-filter: var(--hud-blur);
        box-shadow: 0 10px 28px rgb(46 37 91 / 0.16);
        transition: background 120ms ease;
      }

      .cpk-launcher-hud__news-wrap {
        position: relative;
        margin: 0;
      }

      .cpk-launcher-hud__news {
        position: relative;
        display: flex;
        width: 100%;
        min-width: 0;
        flex-direction: column;
        align-items: flex-start;
        padding: 18px 12px 11px;
        border: 0;
        border-radius: calc(var(--cpk-inspector-shell-radius) - 1px);
        background: transparent;
        color: #fff;
        font-family: inherit;
        line-height: 1;
        text-align: start;
        cursor: pointer;
      }

      .cpk-launcher-hud__news:hover,
      .cpk-launcher-hud__news:focus-visible {
        background: transparent;
      }

      .cpk-launcher-hud__masthead:has(.cpk-launcher-hud__news:hover),
      .cpk-launcher-hud__masthead:has(.cpk-launcher-hud__news:focus-visible),
      .cpk-launcher-hud:has(.cpk-launcher-hud__news:hover)
        .cpk-launcher-hud__arrow,
      .cpk-launcher-hud:has(.cpk-launcher-hud__news:focus-visible)
        .cpk-launcher-hud__arrow {
        background: var(--hud-hover-fill);
      }

      .cpk-launcher-hud__news:focus-visible {
        outline: 2px solid #bec2ff;
        outline-offset: 1px;
      }

      .cpk-launcher-hud__news-title {
        display: block;
        font-size: 12px;
        font-weight: 650;
        line-height: 1.32;
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .cpk-launcher-hud__news-label {
        position: absolute;
        top: -9px;
        left: 12px;
        display: inline-flex;
        min-height: 20px;
        align-items: center;
        padding: 3px 8px;
        border-radius: 6px;
        background: #7563c7;
        color: #fff;
        box-shadow: 0 3px 8px rgb(46 37 91 / 0.18);
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
      }

      .cpk-launcher-hud__news-dismiss {
        position: absolute;
        top: -1px;
        right: 2px;
        z-index: 2;
        display: inline-flex;
        width: 20px;
        height: 20px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: rgb(255 255 255 / 0.68);
        cursor: pointer;
      }

      .cpk-launcher-hud__news-dismiss:hover,
      .cpk-launcher-hud__news-dismiss:focus-visible {
        background: var(--hud-accent-soft);
        color: #fff;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__news-dismiss {
        color: #6e697c;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__news-dismiss:hover,
      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__news-dismiss:focus-visible {
        color: #27233a;
      }

      .cpk-launcher-hud__news-dismiss:focus-visible {
        outline: 2px solid #bec2ff;
        outline-offset: 1px;
      }

      .cpk-launcher-hud__news-dismiss svg {
        width: 7px;
        height: 7px;
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__news {
        color: #17131f;
      }

      .cpk-launcher-hud__dismiss-day {
        position: relative;
        z-index: 1;
        display: flex;
        width: auto;
        min-height: var(--hud-dismiss-day-height);
        align-items: center;
        justify-content: center;
        justify-self: center;
        gap: 6px;
        margin: 0;
        padding: 7px 13px;
        border: 1px solid var(--hud-line);
        border-radius: var(--cpk-inspector-shell-radius);
        background: var(--hud-fill);
        color: #c9cad3;
        box-shadow: 0 8px 20px rgb(17 14 29 / 0.18);
        font-family: inherit;
        font-size: 10px;
        font-weight: 650;
        line-height: 1.2;
        cursor: pointer;
        transition:
          border-color 120ms ease,
          background 120ms ease,
          color 120ms ease;
      }

      .cpk-launcher-hud__dismiss-day:hover,
      .cpk-launcher-hud__dismiss-day:focus-visible {
        border-color: var(--hud-accent);
        background: var(--hud-hover-fill);
        color: #f3f4f8;
      }

      .cpk-launcher-hud__dismiss-day:focus-visible {
        outline: 2px solid #bec2ff;
        outline-offset: 1px;
      }

      .cpk-launcher-hud__dismiss-day svg {
        width: 12px;
        height: 12px;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__dismiss-day {
        box-shadow: 0 8px 20px rgb(46 37 91 / 0.12);
        color: #5f6068;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__dismiss-day:hover,
      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__dismiss-day:focus-visible {
        color: #36373d;
      }

      .cpk-launcher-hud__feature-list {
        position: relative;
        z-index: 1;
        padding: 5px;
        border: 1px solid var(--hud-line);
        border-radius: var(--cpk-inspector-shell-radius);
        background: var(--hud-fill);
        backdrop-filter: var(--hud-blur);
        -webkit-backdrop-filter: var(--hud-blur);
        box-shadow: 0 10px 28px rgb(46 37 91 / 0.16);
      }

      .cpk-launcher-hud__row {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        min-height: 54px;
        border-radius: 9px;
        cursor: pointer;
      }

      .cpk-launcher-hud__row + .cpk-launcher-hud__row {
        border-top: 1px solid var(--hud-line);
        border-radius: 0 0 9px 9px;
      }

      .cpk-launcher-hud__row:hover,
      .cpk-launcher-hud__row:focus-within {
        background: rgb(255 255 255 / 0.06);
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row:hover,
      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row:focus-within {
        background: #f7f5ff;
      }

      .cpk-launcher-hud__primary {
        position: relative;
        display: flex;
        min-width: 0;
      }

      .cpk-launcher-hud__action {
        display: flex;
        width: 100%;
        gap: 8px;
        min-height: 52px;
        align-items: center;
        padding: 7px 4px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: #fff;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        text-align: start;
        cursor: pointer;
      }

      .cpk-launcher-hud__label {
        min-width: 0;
      }

      .cpk-launcher-hud__feature-icon {
        display: inline-flex;
        width: 28px;
        height: 32px;
        flex: none;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: var(--hud-accent);
      }

      .cpk-launcher-hud__feature-icon svg {
        width: 17px;
        height: 17px;
        stroke-width: 1.8;
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__action {
        color: #010507;
      }

      /* Stretch the row action over the whole tab. The icon controls sit
         above this layer and keep their own focused interactions. */
      .cpk-launcher-hud__action::after {
        content: "";
        position: absolute;
        inset: 0;
      }

      .cpk-launcher-hud__controls {
        position: relative;
        z-index: 1;
        display: flex;
        gap: 0;
        align-items: center;
        padding-right: 5px;
      }

      .cpk-launcher-hud__learn-more {
        display: inline-flex;
        width: 24px;
        height: 44px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: rgb(190 194 255 / 0.72);
        cursor: pointer;
      }

      .cpk-launcher-hud__learn-more:hover,
      .cpk-launcher-hud__learn-more:focus-visible {
        color: #fff;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__learn-more {
        color: #777080;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__learn-more:hover,
      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__learn-more:focus-visible {
        color: #4b416b;
      }

      .cpk-launcher-hud__learn-more svg {
        width: 16px;
        height: 16px;
        stroke-width: 1.8;
      }

      .cpk-launcher-hud__toggle {
        display: inline-flex;
        width: 38px;
        height: 44px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: rgb(255 255 255 / 0.78);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .cpk-launcher-hud__toggle:disabled {
        cursor: not-allowed;
        opacity: 1;
      }

      .cpk-launcher-hud__toggle-track {
        position: relative;
        display: block;
        width: 34px;
        height: 20px;
        border: 1px solid rgb(190 194 255 / 0.38);
        border-radius: 999px;
        background: rgb(255 255 255 / 0.08);
        transition:
          border-color 120ms ease,
          background 120ms ease;
      }

      .cpk-launcher-hud__toggle-track::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #8c8e99;
        transition:
          background 120ms ease,
          transform 120ms ease;
      }

      .cpk-launcher-hud__toggle[data-enabled="true"]
        .cpk-launcher-hud__toggle-track {
        border-color: var(--hud-accent);
        background: color-mix(in srgb, var(--hud-accent) 76%, transparent);
      }

      .cpk-launcher-hud__toggle[data-enabled="true"]
        .cpk-launcher-hud__toggle-track::after {
        background: #fff;
        transform: translateX(14px);
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__toggle-track {
        border-color: #c9c9d2;
        background: #e7e7ec;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__toggle-track::after {
        background: #777780;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__toggle[data-enabled="true"]
        .cpk-launcher-hud__toggle-track {
        border-color: #6757b0;
        background: #7563c7;
      }

      .cpk-launcher-hud[data-color-scheme="light"]
        .cpk-launcher-hud__toggle[data-enabled="true"]
        .cpk-launcher-hud__toggle-track::after {
        background: #fff;
      }

      .cpk-launcher-hud__toggle:focus-visible,
      .cpk-launcher-hud__learn-more:focus-visible,
      .cpk-launcher-hud__action:focus-visible {
        outline: 2px solid #bec2ff;
        outline-offset: 1px;
      }

      .cpk-launcher-hud__tooltip {
        position: absolute;
        top: 50%;
        z-index: 30;
        width: max-content;
        max-width: min(220px, 52vw);
        padding: 7px 9px;
        border: 1px solid #3a3d49;
        border-radius: 4px;
        background: #15171e;
        color: #f3f4f8;
        box-shadow: 0 8px 20px rgb(1 5 7 / 0.18);
        font-size: 10px;
        font-weight: 500;
        line-height: 1.45;
        opacity: 0;
        pointer-events: none;
        transform: translate(3px, -50%);
        white-space: normal;
        transition:
          opacity 120ms ease,
          transform 120ms ease;
      }

      .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:hover)
        .cpk-launcher-hud__tooltip,
      .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:focus-visible)
        .cpk-launcher-hud__tooltip {
        opacity: 1;
        transform: translate(0, -50%);
      }

      .cpk-launcher-hud[data-cpk-hud-side="left"] .cpk-launcher-hud__tooltip {
        right: calc(100% + 8px);
        left: auto;
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"] .cpk-launcher-hud__tooltip {
        right: auto;
        left: calc(100% + 8px);
        transform: translate(-3px, -50%);
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"]
        .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:hover)
        .cpk-launcher-hud__tooltip,
      .cpk-launcher-hud[data-cpk-hud-side="right"]
        .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:focus-visible)
        .cpk-launcher-hud__tooltip {
        transform: translate(0, -50%);
      }

      @media (prefers-reduced-motion: reduce) {
        .cpk-launcher-hud,
        .cpk-launcher-hud__tooltip {
          transition: none;
        }
      }

      /*
       * On mount, borrow the hover HUD for one short introduction. The card
       * establishes the destination first; notification, features, and hide
       * action then fall into place from top to bottom. Only opacity and
       * transform move.
       */
      @keyframes cpk-launcher-hud-intro {
        0% {
          opacity: 0;
          transform: translateY(-4px);
        }
        8%,
        88% {
          opacity: 1;
          transform: none;
        }
        100% {
          opacity: 0;
          transform: translateY(3px);
        }
      }

      @keyframes cpk-launcher-hud-waterfall {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }

      .cpk-launcher-hud[data-cpk-hud-intro="true"] {
        animation: cpk-launcher-hud-intro var(--cpk-launcher-hud-intro-duration)
          cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .cpk-launcher-hud[data-cpk-hud-intro="true"]
        :is(
          .cpk-launcher-hud__masthead,
          .cpk-launcher-hud__feature-list,
          .cpk-launcher-hud__row,
          .cpk-launcher-hud__dismiss-day
        ) {
        animation: cpk-launcher-hud-waterfall
          var(--cpk-launcher-hud-waterfall-duration)
          cubic-bezier(0.16, 1, 0.3, 1) both;
        animation-delay: var(--cpk-hud-waterfall-delay);
      }

      @media (prefers-reduced-motion: reduce) {
        .cpk-launcher-hud[data-cpk-hud-intro="true"],
        .cpk-launcher-hud[data-cpk-hud-intro="true"]
          :is(
            .cpk-launcher-hud__masthead,
            .cpk-launcher-hud__feature-list,
            .cpk-launcher-hud__row,
            .cpk-launcher-hud__dismiss-day
          ) {
          animation: none !important;
          opacity: 1;
          transform: none;
        }
      }

      /*
       * Marker on the navigation entry, which is what keeps a signal alive
       * once the panel is open and the launcher is hidden. Static by design:
       * the beat belongs to the launcher, and movement here would compete with
       * the live event stream a developer is actually watching.
       *
       * Tone-selected rather than tone-agnostic, because the marker has to
       * agree with the dot that sent the reader here. Same shape, same
       * placement, one declaration different — as on the launcher, where the
       * treatment is shared and only the injected colour changes.
       */
      .inspector-nav-signal-dot {
        display: inline-block;
        flex: none;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${unsafeCSS(LAUNCHER_SIGNAL_COLORS.news)};
      }
      .inspector-nav-signal-dot[data-cpk-signal-tone="error"] {
        background: ${unsafeCSS(LAUNCHER_SIGNAL_COLORS.error)};
      }

      /* ── Inspector window ────────────────────────────────────────── */
      .inspector-window {
        border: 1px solid #d8d8e8 !important;
        border-radius: var(--cpk-inspector-shell-radius) !important;
        box-shadow: none !important;
      }

      /* ── Header drag area ────────────────────────────────────────── */
      .drag-handle {
        border-bottom-color: #d8d8e8 !important;
        background-color: #f7f6fd !important;
      }

      .inspector-account-strip {
        background: #f7f6fd !important;
        color: #010507 !important;
      }

      .inspector-window[data-color-scheme="dark"] .drag-handle,
      .inspector-window[data-color-scheme="dark"] .inspector-account-strip {
        background: #15171e !important;
      }

      /* ── Tab buttons ─────────────────────────────────────────────── */
      /*
       * Named classes owned by this component — no Tailwind conflict.
       * Active: brand surface/surfaceContainerActive (lilac tint) +
       *         border/borderActionEnabled underline.
       * Dark fill is for primary action buttons only, not nav tabs.
       */
      .cpk-tab-active {
        background-color: rgba(190, 194, 255, 0.18);
        color: #010507;
        font-weight: 600;
      }
      .cpk-tab-icon {
        display: inline-flex;
        flex-shrink: 0;
        align-items: center;
      }
      .cpk-tab-active .cpk-tab-icon {
        color: #5558b2;
      }
      .cpk-tab-inactive {
        background-color: transparent;
        color: #2b2b2b;
      }
      .cpk-tab-inactive .cpk-tab-icon {
        color: #68686e;
      }
      .cpk-tab-inactive:hover {
        background-color: rgba(190, 194, 255, 0.08);
        color: #010507;
        cursor: pointer;
      }
      .cpk-tab-active {
        cursor: pointer;
      }
      /* ── Header controls on the branded account strip ──────────── */
      .drag-handle > div[data-inspector-account-strip] button {
        color: #57575b !important;
        cursor: pointer;
      }
      .drag-handle > div[data-inspector-account-strip] button,
      .inspector-nav-control,
      [data-inspector-thread-cta] {
        outline: 2px solid transparent;
        outline-offset: 2px;
      }
      .drag-handle > div[data-inspector-account-strip] button:hover {
        background-color: rgba(100, 48, 171, 0.09) !important;
        color: #3f176f !important;
      }
      .drag-handle > div[data-inspector-account-strip] button:focus-visible {
        outline: 2px solid #bec2ff !important;
        outline-offset: 2px;
      }
      .inspector-nav-control:focus-visible,
      [data-inspector-thread-cta]:focus-visible,
      [data-inspector-action-placement="threads-footer"]:focus-visible {
        outline: 2px solid #6430ab !important;
        outline-offset: 2px;
      }
      .inspector-sidebar .inspector-nav-control,
      .inspector-sidebar .inspector-sidebar-control,
      .inspector-sidebar .inspector-sidebar-label {
        display: flex !important;
        justify-content: flex-start !important;
        text-align: left !important;
        outline-offset: -2px;
      }
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-control,
      .inspector-sidebar[data-icon-rail="true"] .inspector-sidebar-control,
      .inspector-sidebar[data-icon-rail="true"] .inspector-sidebar-toggle {
        box-sizing: border-box !important;
        width: 36px !important;
        height: 36px !important;
        min-width: 36px !important;
        min-height: 36px !important;
        justify-content: center !important;
        align-items: center !important;
        gap: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-icon,
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-icon svg,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-icon,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-icon
        svg,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-agent-placeholder
        svg {
        width: 18px !important;
        height: 18px !important;
        overflow: visible !important;
      }
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-agent-selector
        > [data-context-dropdown-root="true"] {
        display: flex !important;
        flex: none !important;
        width: 36px !important;
        min-width: 36px !important;
        max-width: 36px !important;
        justify-content: center !important;
        align-items: center !important;
      }
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button,
      .inspector-sidebar[data-icon-rail="true"] .inspector-agent-placeholder {
        display: flex !important;
        width: 36px !important;
        height: 36px !important;
        min-width: 36px !important;
        min-height: 36px !important;
        max-width: 36px !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 0 !important;
        padding: 0 !important;
        transition:
          background-color 180ms ease,
          border-color 180ms ease,
          color 180ms ease !important;
      }
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-label,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-chevron {
        display: none !important;
        width: 0 !important;
        min-width: 0 !important;
        flex: none !important;
        overflow: hidden !important;
      }
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-label,
      .inspector-sidebar[data-icon-rail="true"] .inspector-sidebar-label {
        display: none !important;
      }
      .inspector-sidebar .inspector-nav-control:focus-visible,
      .inspector-sidebar .inspector-sidebar-label:focus-visible,
      .inspector-sidebar .inspector-sidebar-toggle:focus-visible {
        outline-offset: -2px !important;
      }

      /* ── Agent/context dropdown ──────────────────────────────────── */
      [data-context-dropdown-root="true"] > button {
        border-color: #dbdbe5 !important;
        color: #010507 !important;
      }
      [data-context-dropdown-root="true"] > button:hover {
        border-color: #bec2ff !important;
        background-color: #f7f7f9 !important;
      }
      [data-context-dropdown-root="true"] > button > span:last-child {
        color: #68686e !important;
      }
      [data-context-dropdown-root="true"] > div {
        border-color: #dbdbe5 !important;
        box-shadow: 0 4px 12px rgba(1, 5, 7, 0.08) !important;
      }
      [data-context-dropdown-root="true"] > div button:hover,
      [data-context-dropdown-root="true"] > div button:focus {
        background-color: #eceafa !important;
        color: #2f1664 !important;
      }
      .inspector-sidebar
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button {
        border-color: #d8d8e8 !important;
        background-color: rgba(255, 255, 255, 0.7) !important;
        color: #010507 !important;
      }
      .inspector-sidebar
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button:hover {
        border-color: #a5a9ee !important;
        background-color: #ffffff !important;
      }
      .inspector-sidebar
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button
        > span:last-child {
        color: #68686e !important;
      }

      /* ── Resize handle ───────────────────────────────────────────── */
      .resize-handle {
        color: #68686e !important;
      }
      .resize-handle:hover {
        color: #57575b !important;
      }

      /* ── AG-UI Events tab ────────────────────────────────────────── */
      /* Row hover: replace blue tint with brand lilac */
      tr:hover td {
        background-color: rgba(190, 194, 255, 0.08) !important;
      }
      /* Reset/dark action button */
      button[class*="bg-gray-900"] {
        background-color: #010507 !important;
      }
      button[class*="bg-gray-800"] {
        background-color: #2b2b2b !important;
      }
      /* Copy "copied" state: generic green → brand mint */
      button[class*="bg-green-100"] {
        background-color: rgba(133, 236, 206, 0.2) !important;
        color: #087653 !important;
      }

      /* ── Agents tab ──────────────────────────────────────────────── */
      /* Agent icon bubble: blue → lilac */
      span[class*="bg-blue-100"]:not([class*="text-blue-800"]) {
        background-color: rgba(190, 194, 255, 0.15) !important;
      }
      span[class*="text-blue-600"] {
        color: #5558b2 !important;
      }
      /* Running badge: emerald → mint */
      span[class*="bg-emerald-50"] {
        background-color: rgba(133, 236, 206, 0.15) !important;
      }
      span[class*="text-emerald-700"] {
        color: #087653 !important;
      }
      /* Running status dot */
      span[class*="bg-emerald-500"] {
        background-color: #85ecce !important;
      }
      /* Idle dot */
      span[class*="bg-gray-400"] {
        background-color: #afafb7 !important;
      }
      /* User role badge (blue → lilac) */
      span[class*="bg-blue-100"][class*="text-blue-800"] {
        background-color: rgba(190, 194, 255, 0.22) !important;
        border: 1px solid rgba(190, 194, 255, 0.45) !important;
        color: #57575b !important;
      }
      /* Assistant role badge (green → mint) */
      span[class*="bg-green-100"][class*="text-green-800"] {
        background-color: rgba(133, 236, 206, 0.18) !important;
        border: 1px solid rgba(133, 236, 206, 0.4) !important;
        color: #087653 !important;
      }
      /* Tool role badge (amber → orange brand) */
      span[class*="bg-amber-100"][class*="text-amber-800"] {
        background-color: rgba(255, 172, 77, 0.15) !important;
        color: #57575b !important;
      }

      /* ── Frontend Tools tab ──────────────────────────────────────── */
      /* Handler badge (blue → lilac) */
      span[class*="bg-blue-50"][class*="text-blue-700"] {
        background-color: rgba(190, 194, 255, 0.12) !important;
        border-color: rgba(190, 194, 255, 0.3) !important;
        color: #010507 !important;
      }
      /* Renderer badge (purple → lilac-adjacent) */
      span[class*="bg-purple-50"][class*="text-purple-700"] {
        background-color: rgba(190, 194, 255, 0.12) !important;
        border-color: rgba(190, 194, 255, 0.3) !important;
        color: #57575b !important;
      }
      /* Required badge (rose → brand red) */
      span[class*="bg-rose-50"][class*="text-rose-700"] {
        background-color: rgba(250, 95, 103, 0.1) !important;
        border-color: rgba(250, 95, 103, 0.25) !important;
        color: #fa5f67 !important;
      }
      /* Code/default value blocks */
      code[class*="bg-gray-100"],
      span[class*="bg-gray-100"] {
        background-color: #f0f0f4 !important;
      }

      /* ── Connected status bar: match threads header mint (#5BE4BB) ──── */
      /* Outer strip bg + top border + text when connected badge is present */
      .inspector-window
        > div
        > div:last-child
        > div:last-child:has(div[class*="bg-emerald-50"]) {
        background-color: rgba(91, 228, 187, 0.08) !important;
        border-top-color: rgba(91, 228, 187, 0.3) !important;
        color: #087653 !important;
      }
      /* Inner badge — slightly more opaque on the mint bg */
      div[class*="bg-emerald-50"][class*="border-emerald-200"] {
        background-color: rgba(91, 228, 187, 0.12) !important;
        border-color: rgba(91, 228, 187, 0.4) !important;
        color: #087653 !important;
      }
      div[class*="bg-emerald-50"][class*="border-emerald-200"]
        span[class*="opacity-80"] {
        opacity: 1 !important;
      }
      /* Icon bubble inside connected badge → mint tint */
      div[class*="bg-emerald-50"] span[class*="bg-white"] {
        background-color: rgba(91, 228, 187, 0.3) !important;
      }

      /* ── Announcement panel ──────────────────────────────────────── */
      div[class*="border-slate-200"][class*="bg-white"] {
        border-color: #dbdbe5 !important;
      }
      /* Announcement icon bubble: black → brand light lavender + lilac icon */
      span[class*="bg-slate-900"],
      div[class*="bg-slate-900"] {
        background-color: #eee6fe !important;
        color: #5558b2 !important;
      }
      span[class*="text-slate-800"],
      div[class*="text-slate-800"] {
        color: #010507 !important;
      }
    `,
    liveInspectionViewStyles,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof window !== "undefined") {
      this.accountCtaMotionPaused = document.visibilityState !== "visible";
      this.threads.exampleOverviewVideoReducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false;
      this.ensureBrandFonts();
      window.addEventListener("resize", this.handleResize);
      window.addEventListener(
        "pointerdown",
        this.handleGlobalPointerDown as EventListener,
      );
      window.addEventListener("beforeunload", this.handleAppBeforeUnload);
      document.addEventListener(
        "visibilitychange",
        this.handleDocumentVisibilityChange,
      );
      const viteHot = (
        import.meta as ImportMeta & {
          hot?: { on: (event: string, handler: () => void) => void };
        }
      ).hot;
      if (viteHot) {
        viteHot.on("vite:beforeUpdate", this.handleAppBeforeUnload);
      }

      // Load state early (before first render) so menu selection is correct
      this.hydrateStateFromStorageEarly();
      this.refreshInspectorDismissalState();
      this.subscribeToSystemColorScheme();
      this.threads.exampleTourDismissed =
        this.readThreadsExampleTourDismissed();
      // The superseded, origin-scoped read state is discarded rather than
      // migrated: every existing user is re-armed exactly once so they
      // discover the surface that replaced the announcement bubble. Deleting
      // the key rather than leaving it means nothing can fall back to it.
      clearLegacyAnnouncementReadState();
      this.tryAutoAttachCore();
      if (!this.isInspectorDismissed) {
        this.ensureAnnouncementLoading();
      }
      this.subscribeToInspectorThreadBridge();
    }
    this.requestUpdate();
  }

  private ensureBrandFonts(): void {
    ensureBrandFont(document);
  }

  private handleDocumentVisibilityChange = (): void => {
    this.accountCtaMotionPaused = document.visibilityState !== "visible";
    this.refreshInspectorDismissalState();
    // Flush point for defer reason 3: somebody is looking again.
    if (
      document.visibilityState === "visible" &&
      !this.isOpen &&
      !this.isInspectorDismissed
    ) {
      this.flushPendingSignalPulse();
    }
    this.requestUpdate();
  };

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.closePopOut();
    if (typeof window !== "undefined") {
      this.unsubscribeFromSystemColorScheme();
      window.removeEventListener("resize", this.handleResize);
      window.removeEventListener(
        "pointerdown",
        this.handleGlobalPointerDown as EventListener,
      );
      window.removeEventListener("beforeunload", this.handleAppBeforeUnload);
      document.removeEventListener(
        "visibilitychange",
        this.handleDocumentVisibilityChange,
      );
    }
    // Clear pending body-transition timers to prevent post-teardown errors
    for (const id of this.bodyTransitionTimeoutIds) {
      clearTimeout(id);
    }
    this.bodyTransitionTimeoutIds.clear();
    if (this.transitionTimeoutId !== null) {
      clearTimeout(this.transitionTimeoutId);
      this.transitionTimeoutId = null;
    }
    this.clearIconRailContextCloseTimer();
    this.unsubscribeFromInspectorThreadBridge();
    this.stopIntelligenceStory();
    this.clearIntelligencePromptReset();
    disposeHomeFeatureSetupState(this.homeFeatureSetup);
    this.threads.setupPromptCopyGeneration += 1;
    if (this.threads.setupPromptCopyResetTimeoutId !== null) {
      window.clearTimeout(this.threads.setupPromptCopyResetTimeoutId);
      this.threads.setupPromptCopyResetTimeoutId = null;
    }
    this.threads.setupPromptCopyState = "idle";
    this.stopSignalPulse();
    this.cancelGestureTail();
    this.cancelLauncherHudIntro();
    this.clearInspectorDismissalTimer();
    this.cancelThreadRefreshDebounce();
    this.clearInspectorUsageRefresh();
    this.cleanupThreadsExampleOverviewVideo();
    this.removeDockStyles(true); // Clean up any docking styles, skip transition
    this.detachFromCore();
  }

  firstUpdated(): void {
    if (typeof window === "undefined") {
      return;
    }

    if (!this._core) {
      this.tryAutoAttachCore();
    }

    this.measureContext("button");
    this.measureContext("window");

    this.contextState.button.anchor = { horizontal: "right", vertical: "top" };
    this.contextState.button.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };

    this.contextState.window.anchor = { horizontal: "right", vertical: "top" };
    this.contextState.window.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };

    this.hydrateStateFromStorage();
    this.contextState.window.size = this.clampWindowSize(
      this.contextState.window.size,
    );

    // `hydrateStateFromStorage` may have restored `selectedMenu: "memories"`.
    // The memory subscription is normally created on a Memories-tab CLICK via
    // `handleMenuSelect`, which never fires when the tab boots already active —
    // leaving the realtime indicator stuck on the default "connecting" and the
    // list empty until the user toggles tabs. Subscribe now when the Memories
    // tab is the active tab. Gated on the active tab to preserve INSP-1 (no
    // unconditional subscribe), and safe if core is not yet attached or already
    // subscribed — `ensureMemorySubscription` early-returns in both cases.
    if (this.selectedMenu === "memories") {
      this.ensureMemorySubscription();
    }

    // Apply docking styles if open and docked (skip transition on initial load)
    if (this.isOpen && this.dockMode !== "floating") {
      this.applyDockStyles(true);
    }

    this.applyAnchorPosition("button");

    if (this.dockMode === "floating") {
      if (this.hasCustomPosition.window) {
        this.applyAnchorPosition("window");
      } else {
        this.centerContext("window");
      }
    }

    if (this.isInspectorDismissed) {
      // The close action persists this immediately. This branch also covers a
      // different localhost port whose own Inspector state was still open.
      this.persistState();
    } else {
      this.ensureAnnouncementLoading();
    }

    this.updateHostTransform(this.isOpen ? "window" : "button");
    if (!this.isInspectorDismissed) {
      this.scheduleLauncherHudIntro();
    }
  }

  render() {
    if (this.isInspectorDismissed) return nothing;
    return this.isOpen
      ? html`
          <div data-inspector-portal-anchor></div>
        `
      : this.renderButton();
  }

  protected willUpdate(): void {
    // Before the render that paints the dot: every mutation of the underlying
    // connection / thread state already requests an update, so mirroring the
    // latches here keeps the resting dot in step with the state it reports.
    this.evaluateErrorSignals();
    this.reconcileSelectedMenuVisibility();
    if (this.isOpen && this.dockMode === "docked-left") {
      this.setAttribute("data-docked", "true");
    } else {
      this.removeAttribute("data-docked");
    }
  }

  protected updated(): void {
    this.syncInspectorPortal();
    synchronizeAnnouncementCopyControls(this.activeRoot, this.getClipboard());
    this.syncThreadsExampleOverviewVideo();
    this.maybeTrackInspectorMetadataViews();
    this.maybeTrackNewsSignalViewed();
    // The pill's full width is only measurable once it has been laid out, and
    // the answer decides both the direction and the telemetry label below, so
    // this runs before the visibility event rather than after it.
    this.resolvePillDirection();
    this.maybeTrackErrorSignalViewed();
    // "Rendered with content" is a property of the finished render, so the
    // news signal is retired here rather than from a render method.
    this.maybeCompleteWhatsNewView();
    this.maybeCompleteEventErrorView();
    this.flushErrorLandingScroll();
    this.maybeTrackHomeViewed();
    this.syncIntelligenceStory();

    if (!this.isOpen) {
      this.lastScrolledAgentNavigationLayout = null;
      return;
    }

    const navigation = this.activeRoot.querySelector<HTMLElement>(
      'nav[aria-label="Inspector"]',
    );
    if (!navigation) {
      return;
    }

    const activeControl = navigation.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (!activeControl) {
      return;
    }

    const layoutKey = [
      this.selectedMenu,
      this.dockMode,
      Math.round(this.contextState.window.size.width),
      typeof window === "undefined" ? 0 : window.innerWidth,
      navigation.clientWidth,
      navigation.scrollWidth,
    ].join(":");
    if (this.lastScrolledAgentNavigationLayout === layoutKey) {
      return;
    }

    if (typeof activeControl.scrollIntoView === "function") {
      activeControl.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    this.lastScrolledAgentNavigationLayout = layoutKey;
  }

  private renderButton() {
    // `.console-button` owns the launcher dimensions and publishes the same
    // number as `--cpk-launcher-size` for the signal dot's rim placement.
    // Tailwind scan tokens retained for generated-sheet stability: ease-in-out
    // ease-out
    const buttonClasses = [
      "console-button",
      "group",
      "relative",
      "pointer-events-auto",
      "inline-flex",
      // Kept as Tailwind scan tokens so the generated sheet stays stable;
      // the later `.console-button` rule owns the responsive dimensions.
      "h-9",
      "w-9",
      "items-center",
      "justify-center",
      "rounded-full",
      "border",
      "text-xs",
      "font-medium",
      "text-white",
      "focus-visible:outline",
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-[#BEC2FF]",
      "touch-none",
      "select-none",
      this.isDragging ? "cursor-grabbing" : "cursor-pointer",
    ].join(" ");

    // One dot, and the highest-priority armed signal owns it. Everything the
    // launcher paints comes from that signal's description.
    const activeSignal = this.getActiveLauncherSignal();
    const signal = activeSignal ? LAUNCHER_SIGNALS[activeSignal] : null;
    const signalStyles = signal
      ? {
          "--cpk-launcher-signal": LAUNCHER_SIGNAL_COLORS[signal.tone],
          "--cpk-launcher-cadence": `${signal.cadence}ms`,
        }
      : {};

    return html`
      <div
        class="console-button-wrapper"
        data-cpk-hud=${this.launcherHudOpen ? "open" : "closed"}
        @pointerenter=${this.handleLauncherHudEnter}
        @pointerleave=${this.handleLauncherHudLeave}
        @focusin=${this.handleLauncherHudFocusIn}
        @focusout=${this.handleLauncherHudFocusOut}
        @keydown=${this.handleLauncherHudKeydown}
      >
        ${this.renderLauncherPill()}
        <button
          class=${buttonClasses}
          type="button"
          aria-expanded=${this.launcherHudOpen ? "true" : "false"}
          aria-controls=${this.launcherHudOpen ? "cpk-launcher-hud" : nothing}
          aria-label=${
            // The dot is decorative and hidden from assistive technology, and
            // the accessible signal for an announcement lives on its
            // navigation entry. A broken setup has no such entry until the
            // panel is open, so the launcher itself has to name the failure
            // class — otherwise a screen-reader user is the only user with no
            // signal outside the panel.
            signal && signal.tone === "error"
              ? `${LAUNCHER_BASE_LABEL}, ${signal.accessibleLabel}`
              : LAUNCHER_BASE_LABEL
          }
          title=${HUD_INSPECTOR_LABEL}
          data-drag-context="button"
          data-cpk-signal=${signal ? signal.tone : nothing}
          data-cpk-signal-pulsing=${
            activeSignal !== null && this.pulsingSignal === activeSignal
              ? "true"
              : nothing
          }
          style=${styleMap(signalStyles)}
          data-dragging=${
            this.isDragging && this.pointerContext === "button"
              ? "true"
              : "false"
          }
          @pointerdown=${this.handlePointerDown}
          @pointermove=${this.handlePointerMove}
          @pointerup=${this.handlePointerUp}
          @pointercancel=${this.handlePointerCancel}
          @click=${this.handleButtonClick}
        >
          <img
            src=${inspectorLogoKiteUrl}
            alt="Inspector logo"
            class="cpk-launcher-mark h-6 w-auto"
            loading="lazy"
          />
          ${
            // Purely decorative: the button is the target, it carries the
            // stable hover hint and the accessible name, and an unread
            // announcement is announced by its navigation entry, which is
            // where a keyboard user arrives.
            activeSignal !== null
              ? html`<span
                    class="cpk-launcher-signal-wash"
                    aria-hidden="true"
                  ></span>
                  <span
                    class="cpk-launcher-signal-dot"
                    data-cpk-signal-dot=${activeSignal}
                    aria-hidden="true"
                  ></span>`
              : nothing
          }
        </button>
        ${
          // The pill is a sighted-only surface, so the failure is also spoken
          // once per outage — otherwise the reader who was given the failure
          // class in the launcher's accessible name in the companion change is
          // excluded again, since a changed name is only read on focus.
          //
          // POLITE, never assertive. Speech is serial: it occupies the channel
          // the reader is using to operate their own software, and interrupting
          // that mid-sentence is out of the question for a development tool.
          //
          // It is rendered whenever the launcher is, empty and with no visual
          // footprint, because a live region has to exist on the page before
          // its content lands to be announced reliably.
          html`<span
            class="sr-only"
            data-cpk-launcher-announcement
            role="status"
            aria-live="polite"
            >${this.getGestureLabel() ?? ""}</span
          >`
        }
        ${this.renderLauncherHud()}
      </div>
    `;
  }

  /**
   * The words the running gesture carries, or null when the launcher is quiet.
   *
   * Read from the signal's own description rather than from a condition on the
   * tone, so a third signal can carry a pill by declaring a label.
   */
  private getGestureLabel(): string | null {
    if (this.gestureSignal === null) return null;
    return LAUNCHER_SIGNALS[this.gestureSignal].pillLabel ?? null;
  }

  /**
   * The pill, laid out at its full width and clipped, for the whole gesture.
   *
   * It renders from the first frame of the beat — clipped to nothing, so it
   * shows nothing — because the room it needs cannot be measured until it has
   * been laid out, and the direction is decided at gesture start.
   */
  private renderLauncherPill(): TemplateResult | typeof nothing {
    const key = this.gestureSignal;
    if (key === null || this.pillPhase === null) return nothing;
    const signal = LAUNCHER_SIGNALS[key];
    const label = signal.pillLabel;
    if (label === undefined) return nothing;
    return html`
      <span
        class="cpk-launcher-pill"
        data-cpk-launcher-pill=${key}
        data-cpk-pill-phase=${this.pillPhase}
        data-cpk-pill-direction=${
          // Before the measurement the pill is laid out as if it were opening
          // left, which is width-identical to the other side and shows nothing
          // either way while the clip is closed.
          this.pillDirection ?? "left"
        }
        style=${styleMap({
          "--cpk-launcher-signal": LAUNCHER_SIGNAL_COLORS[signal.tone],
          "--cpk-launcher-pill-open": `${ERROR_GESTURE_MS.open}ms`,
          "--cpk-launcher-pill-close": `${ERROR_GESTURE_MS.close}ms`,
        })}
        aria-hidden="true"
        @click=${this.handlePillClick}
      >
        <span class="cpk-launcher-pill__heading" data-cpk-pill-heading
          >${label}</span
        >
        <span class="cpk-launcher-pill__subline" data-cpk-pill-subline
          >${PILL_SUBLINE_LABEL}</span
        >
      </span>
    `;
  }

  /**
   * A click on the pill opens the Inspector, exactly as pressing the mark
   * does — reusing the launcher's own open source, so the telemetry catalogue
   * is untouched and the two paths cannot be told apart downstream.
   *
   * Deliberately NOT focusable and deliberately not in the tab order: the
   * launcher beside it is already a focusable control for this same action,
   * and a second tab stop for one action is a regression. The pill stays
   * `aria-hidden` and this handler is a pointer affordance only.
   *
   * The gesture ends with the open, because `openInspector` cancels the tail —
   * the panel is over the launcher, so there is nothing left to reveal.
   */
  private handlePillClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.openInspector("floating_button");
  };

  /** Whether a persisted temporary dismissal is still active. */
  private get isInspectorDismissed(): boolean {
    return (
      this.inspectorDismissedUntil !== null &&
      this.inspectorDismissedUntil > Date.now()
    );
  }

  /** Cancel the timer that restores Inspector after a temporary dismissal. */
  private clearInspectorDismissalTimer(): void {
    if (this.inspectorDismissalTimer === null) return;
    clearTimeout(this.inspectorDismissalTimer);
    this.inspectorDismissalTimer = null;
  }

  /** Schedule Inspector to return just after its persisted deadline. */
  private scheduleInspectorDismissalExpiry(): void {
    this.clearInspectorDismissalTimer();
    if (this.inspectorDismissedUntil === null) return;
    const delay = Math.max(0, this.inspectorDismissedUntil - Date.now() + 25);
    this.inspectorDismissalTimer = setTimeout(() => {
      this.inspectorDismissalTimer = null;
      this.refreshInspectorDismissalState();
    }, delay);
  }

  /** Reconcile this tab with host-scoped dismissal state from other ports. */
  private refreshInspectorDismissalState(): void {
    const hadDismissal = this.inspectorDismissedUntil !== null;
    this.inspectorDismissedUntil = loadInspectorDismissedUntil();
    this.clearInspectorDismissalTimer();

    if (this.inspectorDismissedUntil !== null) {
      this.closePopOut();
      this.closeInspector();
      this.scheduleInspectorDismissalExpiry();
      if (!hadDismissal) this.requestUpdate();
      return;
    }

    if (!hadDismissal || !this.isConnected) return;
    this.ensureAnnouncementLoading();
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (!this.isConnected || this.isInspectorDismissed) return;
      this.measureContext("button");
      this.applyAnchorPosition("button");
      this.scheduleLauncherHudIntro();
      this.flushPendingSignalPulse();
    });
  }

  /** Hide Inspector for a supported duration and persist it for this host. */
  private dismissInspectorFor(duration: InspectorDismissalDuration): void {
    const now = Date.now();
    const until = now + INSPECTOR_DISMISSAL_MS[duration];
    saveInspectorDismissedUntil(until, now);
    this.inspectorDismissedUntil = until;
    this.scheduleInspectorDismissalExpiry();
    this.settingsOpen = false;
    this.closeLauncherHud();
    this.stopSignalPulse();
    this.cancelGestureTail();
    this.cancelLauncherHudIntro();
    this.closePopOut();

    if (this.isOpen) {
      this.closeInspector();
      return;
    }

    this.persistState();
    this.requestUpdate();
  }

  private isLauncherHudBlocked(): boolean {
    return this.gestureSignal !== null || this.isInspectorDismissed;
  }

  private scheduleLauncherHudIntro(
    delay: number = LAUNCHER_HUD_INTRO_MS.delay,
  ): void {
    if (this.isInspectorDismissed) return;
    if (this.launcherHudIntroStartTimer !== null) {
      clearTimeout(this.launcherHudIntroStartTimer);
    }
    this.launcherHudIntroStartTimer = setTimeout(() => {
      this.launcherHudIntroStartTimer = null;
      if (!this.isConnected || this.isOpen || this.isInspectorDismissed) return;
      if (this.isLauncherHudBlocked()) {
        this.scheduleLauncherHudIntro(LAUNCHER_HUD_INTRO_MS.blockedRetry);
        return;
      }

      this.resolveLauncherHudSide();
      this.launcherHudIntro = true;
      this.launcherHudOpen = true;
      this.requestUpdate();
      this.launcherHudIntroEndTimer = setTimeout(() => {
        this.launcherHudIntroEndTimer = null;
        this.launcherHudIntro = false;
        this.launcherHudOpen = false;
        this.requestUpdate();
      }, LAUNCHER_HUD_INTRO_MS.duration);
    }, delay);
  }

  private cancelLauncherHudIntro(): void {
    if (this.launcherHudIntroStartTimer !== null) {
      clearTimeout(this.launcherHudIntroStartTimer);
      this.launcherHudIntroStartTimer = null;
    }
    if (this.launcherHudIntroEndTimer !== null) {
      clearTimeout(this.launcherHudIntroEndTimer);
      this.launcherHudIntroEndTimer = null;
    }
    if (!this.launcherHudIntro) return;
    this.launcherHudIntro = false;
    if (this.isConnected) {
      this.requestUpdate();
    }
  }

  private resolveLauncherHudSide(): void {
    if (typeof window === "undefined") {
      this.launcherHudSide = "left";
      return;
    }
    const button =
      this.activeRoot.querySelector<HTMLElement>(".console-button");
    if (!button) {
      this.launcherHudSide = "left";
      return;
    }
    const mark = button.getBoundingClientRect();
    if (mark.left - LAUNCHER_HUD_WIDTH >= EDGE_MARGIN) {
      this.launcherHudSide = "left";
      return;
    }
    this.launcherHudSide = "right";
  }

  private openLauncherHud(): void {
    if (this.isLauncherHudBlocked() || this.isOpen) return;
    this.resolveLauncherHudSide();
    if (this.launcherHudCloseTimer !== null) {
      clearTimeout(this.launcherHudCloseTimer);
      this.launcherHudCloseTimer = null;
    }
    if (this.launcherHudOpen) return;
    this.launcherHudOpen = true;
    this.requestUpdate();
  }

  private closeLauncherHud(): void {
    this.cancelLauncherHudIntro();
    if (this.launcherHudCloseTimer !== null) {
      clearTimeout(this.launcherHudCloseTimer);
      this.launcherHudCloseTimer = null;
    }
    if (!this.launcherHudOpen) return;
    this.launcherHudOpen = false;
    this.requestUpdate();
  }

  private handleLauncherHudEnter = (): void => {
    this.cancelLauncherHudIntro();
    this.openLauncherHud();
  };

  private handleLauncherHudLeave = (): void => {
    if (this.launcherHudCloseTimer !== null) {
      clearTimeout(this.launcherHudCloseTimer);
    }
    this.launcherHudCloseTimer = setTimeout(() => {
      this.launcherHudCloseTimer = null;
      this.closeLauncherHud();
    }, 160);
  };

  private handleLauncherHudFocusIn = (): void => {
    this.cancelLauncherHudIntro();
    this.openLauncherHud();
  };

  private handleLauncherHudFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    const wrapper = event.currentTarget;
    if (
      next instanceof Node &&
      wrapper instanceof Node &&
      wrapper.contains(next)
    ) {
      return;
    }
    this.closeLauncherHud();
  };

  private handleLauncherHudKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (!this.launcherHudOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeLauncherHud();
    this.activeRoot
      .querySelector<HTMLButtonElement>(".console-button")
      ?.focus();
  };

  private handleHudActionClick = (
    event: Event,
    row: LauncherHudRowId,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    this.hudLandingMenu =
      row === "threads" ? "threads" : row === "learning" ? "memories" : "home";
    this.closeLauncherHud();
    this.openInspector("floating_button");
  };

  private handleHudRowClick = (event: Event, row: LauncherHudRowId): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".cpk-launcher-hud__controls, [data-cpk-hud-action]")
    ) {
      return;
    }
    this.handleHudActionClick(event, row);
  };

  private handleHudNewsClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.hudLandingMenu = WHATS_NEW_MENU_KEY;
    this.closeLauncherHud();
    this.openInspector("floating_button");
  };

  private handleHudNewsDismissClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.clearNewsSignal();
    this.activeRoot
      .querySelector<HTMLButtonElement>(".console-button")
      ?.focus({ preventScroll: true });
  };

  /** Apply the launcher HUD's one-day dismissal without opening Inspector. */
  private handleHudDismissDayClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.dismissInspectorFor("day");
  };

  private getUnreadAnnouncementTitle(): string | null {
    if (!this.newsSignalArmed || !this.announcementLoaded) return null;
    const title = this.announcement?.preview.text.trim() || "New in CopilotKit";
    const titleCharacters = Array.from(title);
    return titleCharacters.length > HUD_ANNOUNCEMENT_TITLE_LIMIT
      ? `${titleCharacters
          .slice(0, HUD_ANNOUNCEMENT_TITLE_LIMIT)
          .join("")
          .trimEnd()}...`
      : title;
  }

  private renderHudRow(args: {
    id: LauncherHudRowId;
    label: string;
    icon: LucideIconName;
    connected?: boolean;
    introIndex: number;
  }): TemplateResult {
    const detailId = `cpk-hud-detail-${args.id}`;
    return html`
      <li
        class="cpk-launcher-hud__row"
        data-cpk-hud-row=${args.id}
        data-cpk-hud-action-kind="navigate"
        style=${styleMap({
          "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(
            args.introIndex,
          ),
        })}
        @click=${(event: Event) => this.handleHudRowClick(event, args.id)}
      >
        <span class="cpk-launcher-hud__primary">
          <button
            type="button"
            class="cpk-launcher-hud__action"
            data-cpk-hud-action
            aria-label=${`Open ${args.label} in Inspector`}
            @click=${(event: Event) =>
              this.handleHudActionClick(event, args.id)}
            @pointerdown=${(event: Event) => event.stopPropagation()}
          >
            <span
              class="cpk-launcher-hud__feature-icon"
              data-cpk-hud-icon=${args.id}
              aria-hidden="true"
              >${this.renderIcon(args.icon)}</span
            >
            <span class="cpk-launcher-hud__label">${args.label}</span>
          </button>
          <span
            class="cpk-launcher-hud__tooltip"
            id=${detailId}
            role="tooltip"
            >${HUD_LEARN_MORE_LABEL}</span
          >
        </span>
        <span class="cpk-launcher-hud__controls">
          <button
            type="button"
            class="cpk-launcher-hud__learn-more"
            data-cpk-hud-learn-more=${args.id}
            aria-label=${`Learn more about ${args.label}`}
            aria-describedby=${detailId}
            @click=${(event: Event) =>
              this.handleHudActionClick(event, args.id)}
            @pointerdown=${(event: Event) => event.stopPropagation()}
          >
            ${this.renderIcon("CircleHelp")}
          </button>
          <button
            type="button"
            class="cpk-launcher-hud__toggle"
            data-cpk-hud-toggle=${args.id}
            data-enabled=${args.connected ? "true" : "false"}
            aria-label=${
              args.connected
                ? `${args.label} is enabled`
                : `Open ${args.label} in Inspector`
            }
            ?disabled=${args.connected}
            @click=${(event: Event) =>
              this.handleHudActionClick(event, args.id)}
            @pointerdown=${(event: Event) => event.stopPropagation()}
          >
            <span
              class="cpk-launcher-hud__toggle-track"
              aria-hidden="true"
            ></span>
          </button>
        </span>
      </li>
    `;
  }

  private renderLauncherHud(): TemplateResult | typeof nothing {
    if (!this.launcherHudOpen) return nothing;
    // The launcher must agree with Home about feature availability. Raw
    // transport flags can be present for a runtime that is not entitled to use
    // Intelligence, which previously made the HUD show every service as on.
    const homeModel = this.getHomeModel();
    const threadsOn = homeModel.services.some(
      (service) => service.id === "threads" && service.enabled,
    );
    const learningOn = homeModel.services.some(
      (service) => service.id === "memory" && service.enabled,
    );
    const announcementTitle = this.getUnreadAnnouncementTitle();
    const featureBlockIntroIndex = announcementTitle ? 1 : 0;
    return html`
      <div
        class="cpk-launcher-hud"
        id="cpk-launcher-hud"
        data-cpk-launcher-hud
        data-cpk-hud-side=${this.launcherHudSide}
        data-cpk-hud-vertical=${this.contextState.button.anchor.vertical}
        data-cpk-hud-intro=${this.launcherHudIntro ? "true" : nothing}
        data-color-scheme=${this.colorScheme}
        style=${styleMap({
          "--cpk-launcher-hud-intro-duration": `${LAUNCHER_HUD_INTRO_MS.duration}ms`,
          "--cpk-launcher-hud-waterfall-duration": `${LAUNCHER_HUD_INTRO_MS.waterfallDuration}ms`,
        })}
      >
        <span class="cpk-launcher-hud__arrow" aria-hidden="true"></span>
        <div class="cpk-launcher-hud__card">
          ${
            announcementTitle
              ? html`
                  <div
                    class="cpk-launcher-hud__masthead"
                    style=${styleMap({
                      "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(0),
                    })}
                  >
                    <div class="cpk-launcher-hud__news-wrap">
                      <button
                        type="button"
                        class="cpk-launcher-hud__news"
                        data-cpk-hud-news
                        aria-label=${`Open new notification: ${announcementTitle}`}
                        @click=${this.handleHudNewsClick}
                        @pointerdown=${(event: Event) => event.stopPropagation()}
                      >
                        <span
                          class="cpk-launcher-hud__news-label"
                          data-cpk-hud-news-label
                          aria-hidden="true"
                          >New</span
                        >
                        <span class="cpk-launcher-hud__news-title"
                          >${announcementTitle}</span
                        >
                      </button>
                      <button
                        type="button"
                        class="cpk-launcher-hud__news-dismiss"
                        data-cpk-hud-news-dismiss
                        aria-label="Dismiss notification"
                        @click=${this.handleHudNewsDismissClick}
                        @pointerdown=${(event: Event) => event.stopPropagation()}
                      >
                        ${this.renderIcon("X")}
                      </button>
                    </div>
                  </div>
                `
              : nothing
          }
          <ul
            class="cpk-launcher-hud__list cpk-launcher-hud__feature-list"
            role="list"
            style=${styleMap({
              "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(
                featureBlockIntroIndex,
              ),
            })}
          >
            ${this.renderHudRow({
              id: "threads",
              label: HUD_THREADS_LABEL,
              icon: "MessageSquare",
              connected: threadsOn,
              introIndex: featureBlockIntroIndex + 1,
            })}
            ${this.renderHudRow({
              id: "learning",
              label: HUD_LEARNING_LABEL,
              icon: "Brain",
              connected: learningOn,
              introIndex: featureBlockIntroIndex + 2,
            })}
          </ul>
          <button
            type="button"
            class="cpk-launcher-hud__dismiss-day"
            data-cpk-dismiss-inspector="day"
            style=${styleMap({
              "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(
                featureBlockIntroIndex + 3,
              ),
            })}
            @click=${this.handleHudDismissDayClick}
            @pointerdown=${(event: Event) => event.stopPropagation()}
          >
            <span aria-hidden="true">${this.renderIcon("Clock")}</span>
            Hide Inspector for a day
          </button>
        </div>
      </div>
    `;
  }

  /** Render a trusted action with optional context-specific copy. */
  private renderInspectorAction(
    action: InspectorMetadataAction,
    placement: "threads-footer" | "locked",
    displayLabel:
      | InspectorMetadataAction["label"]
      | "Upgrade Your Plan" = action.label,
  ) {
    const actionIntent =
      displayLabel === "Upgrade Your Plan" ? "upgrade" : undefined;
    return html`
      <a
        data-inspector-action-placement=${placement}
        data-inspector-action-intent=${actionIntent ?? nothing}
        href=${action.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="${displayLabel} (opens in a new tab)"
        style=${
          placement === "threads-footer"
            ? ""
            : "display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:6px;border:1px solid #dbdbe5;border-radius:7px;background:#ffffff;padding:8px 12px;color:#57575b;font-size:12px;font-weight:600;text-decoration:none;outline-style:solid;outline-width:2px;outline-color:transparent;outline-offset:2px;cursor:pointer;"
        }
        @click=${() =>
          this.handleInspectorMetadataActionClick(action, placement)}
      >
        ${displayLabel}
      </a>
    `;
  }

  private renderInspectorSidebar(
    iconRail: boolean,
    automaticallyCollapsed: boolean,
    agentSelector: TemplateResult | typeof nothing,
  ) {
    const homeModel = this.getHomeModel();
    return html`
      <aside
        class="inspector-sidebar"
        data-icon-rail=${iconRail ? "true" : "false"}
      >
        ${
          iconRail && this.sidebarRailTooltip
            ? html`
              <span
                class="inspector-sidebar-rail-tooltip"
                role="tooltip"
                style=${`top: ${this.sidebarRailTooltip.top}px`}
                >${this.sidebarRailTooltip.label}</span
              >
            `
            : nothing
        }
        <div
          class="inspector-sidebar-agent-scope"
          data-inspector-sidebar-agent-selector
        >
          <div class="inspector-agent-selector">${agentSelector}</div>
        </div>
        <nav class="inspector-sidebar-nav" aria-label="Inspector">
          ${INSPECTOR_NAV_SECTIONS.map(({ group, label }) => {
            const items = this.getVisibleMenuItemsForGroup(group);
            if (items.length === 0) {
              return nothing;
            }
            return html`
              <div
                class="inspector-sidebar-section"
                data-inspector-section=${group}
              >
                ${
                  label
                    ? html`<button
                      type="button"
                      class="inspector-sidebar-label"
                      data-inspector-group=${group}
                      aria-label=${label}
                      style=${INTERACTIVE_FOCUS_BASE_STYLE}
                      @click=${() => this.handleGroupSelect(group)}
                    >
                      ${label}
                    </button>`
                    : nothing
                }
                ${items.map((item) => {
                  const isSelected = this.selectedMenu === item.key;
                  const marker = this.getNavigationSignalFor(item.key);
                  return html`
                    <button
                      type="button"
                      class="inspector-nav-control inspector-sidebar-control ${
                        isSelected ? "inspector-nav-control-active" : ""
                      }"
                      data-inspector-group=${group}
                      data-inspector-menu-key=${item.key}
                      aria-current=${isSelected ? "page" : nothing}
                      aria-label=${
                        marker
                          ? `${item.label}, ${marker.accessibleLabel}`
                          : item.label
                      }
                      data-inspector-tooltip=${item.label}
                      title=${iconRail ? nothing : item.label}
                      style=${INTERACTIVE_FOCUS_BASE_STYLE}
                      @pointerenter=${
                        iconRail ? this.handleSidebarRailTooltipShow : nothing
                      }
                      @pointerleave=${
                        iconRail ? this.handleSidebarRailTooltipHide : nothing
                      }
                      @focus=${
                        iconRail ? this.handleSidebarRailTooltipShow : nothing
                      }
                      @blur=${
                        iconRail ? this.handleSidebarRailTooltipHide : nothing
                      }
                      @click=${() => this.handleMenuSelect(item.key)}
                    >
                      <span class="inspector-nav-icon" aria-hidden="true">
                        ${
                          item.key === "threads"
                            ? unsafeHTML(this.customTabIcons.threads)
                            : this.renderIcon(item.icon)
                        }
                      </span>
                      <span class="inspector-nav-label">${item.label}</span>
                      ${
                        marker
                          ? html`
                            <span
                              class="inspector-nav-signal-dot"
                              data-cpk-signal-tone=${marker.tone}
                              aria-hidden="true"
                            ></span>
                          `
                          : nothing
                      }
                    </button>
                  `;
                })}
              </div>
            `;
          })}
        </nav>
        ${
          automaticallyCollapsed
            ? nothing
            : html`
              <div class="inspector-sidebar-footer">
                ${
                  iconRail
                    ? nothing
                    : html`
                      <div class="inspector-sidebar-status-list">
                        ${this.renderSidebarIntelligenceStatus(homeModel)}
                      </div>
                    `
                }
                <button
                  type="button"
                  class="inspector-sidebar-toggle"
                  data-inspector-sidebar-toggle
                  aria-label=${iconRail ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded=${iconRail ? "false" : "true"}
                  data-inspector-tooltip=${
                    iconRail ? "Expand sidebar" : nothing
                  }
                  title=${iconRail ? nothing : "Collapse sidebar"}
                  style=${INTERACTIVE_FOCUS_BASE_STYLE}
                  @pointerenter=${
                    iconRail ? this.handleSidebarRailTooltipShow : nothing
                  }
                  @pointerleave=${
                    iconRail ? this.handleSidebarRailTooltipHide : nothing
                  }
                  @focus=${
                    iconRail ? this.handleSidebarRailTooltipShow : nothing
                  }
                  @blur=${
                    iconRail ? this.handleSidebarRailTooltipHide : nothing
                  }
                  @click=${this.handleSidebarToggle}
                >
                  <span class="inspector-nav-icon" aria-hidden="true">
                    ${this.renderIcon(
                      iconRail ? "ChevronRight" : "ChevronLeft",
                    )}
                  </span>
                  <span class="inspector-nav-label"
                    >${iconRail ? "Expand" : "Collapse"}</span
                  >
                </button>
              </div>
            `
        }
      </aside>
    `;
  }

  private renderSidebarIntelligenceStatus(model: HomeModel) {
    const connected = model.hero.connection === "connected";
    const organizationName = model.project?.organizationName;
    const planLabel = model.project?.planLabel;
    const action = model.hero.action;
    const renewing = action?.kind === "renew";
    if (!connected && action) {
      const stateLabel = renewing
        ? "Intelligence plan expired"
        : "Intelligence is off";
      const setupLabel = renewing
        ? "Renew to restore access"
        : "Set up Threads and Memory";
      return html`
        <a
          class="inspector-sidebar-status-card inspector-sidebar-intelligence inspector-sidebar-intelligence-setup"
          data-inspector-sidebar-intelligence
          data-inspector-sidebar-intelligence-action=${action.kind}
          data-state="disconnected"
          href=${action.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="${action.label} to enable Threads and Memory (opens in a new tab)"
          title=${action.label}
          style=${INTERACTIVE_FOCUS_BASE_STYLE}
          @click=${() => this.handleHomeHeroCta(action)}
        >
          <span class="inspector-sidebar-status-copy">
            <strong>${stateLabel}</strong>
            <span>${setupLabel}</span>
          </span>
          <span class="inspector-sidebar-setup-arrow" aria-hidden="true">
            ${this.renderIcon("ArrowUpRight")}
          </span>
        </a>
      `;
    }

    const primaryLabel = connected
      ? (organizationName ?? "Intelligence")
      : "Intelligence unavailable";
    const secondaryLabel = connected
      ? planLabel
        ? `${planLabel} plan`
        : "Connected"
      : "Threads and Memory are off";
    const label = connected
      ? `${primaryLabel}, ${secondaryLabel}, Intelligence connected`
      : "Connect Intelligence";
    const actionLabel = action?.label;
    const description = connected
      ? `${secondaryLabel} · Intelligence connected`
      : "Threads and Memory need Intelligence.";
    return html`
      <section
        class="inspector-sidebar-status-card inspector-sidebar-intelligence"
        data-inspector-sidebar-intelligence
        data-state=${connected ? "connected" : "disconnected"}
        aria-label=${label}
        title=${description}
      >
        <span class="inspector-sidebar-status-copy">
          <strong>${primaryLabel}</strong>
          <span>${secondaryLabel}</span>
        </span>
        ${
          action
            ? html`
              <a
                class="inspector-sidebar-status-action"
                data-inspector-sidebar-intelligence-action=${action.kind}
                href=${action.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="${actionLabel} (opens in a new tab)"
                title=${actionLabel}
                style=${INTERACTIVE_FOCUS_BASE_STYLE}
                @click=${() => this.handleHomeHeroCta(action)}
              >
                <span class="inspector-sidebar-status-action-label"
                  >${actionLabel}</span
                >
                <span aria-hidden="true"
                  >${this.renderIcon("ArrowUpRight")}</span
                >
              </a>
            `
            : nothing
        }
      </section>
    `;
  }

  private handleSidebarToggle = (): void => {
    this.sidebarRailTooltip = null;
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.persistState();
    this.requestUpdate();
  };

  private handleSidebarRailTooltipShow = (event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const label = target.dataset.inspectorTooltip;
    const sidebar = target.closest<HTMLElement>(".inspector-sidebar");
    if (!label || !sidebar) {
      return;
    }

    const targetBounds = target.getBoundingClientRect();
    const sidebarBounds = sidebar.getBoundingClientRect();
    this.sidebarRailTooltip = {
      label,
      top: targetBounds.top - sidebarBounds.top + targetBounds.height / 2,
    };
    this.requestUpdate();
  };

  private handleSidebarRailTooltipHide = (): void => {
    if (this.sidebarRailTooltip === null) {
      return;
    }
    this.sidebarRailTooltip = null;
    this.requestUpdate();
  };

  private handleColorSchemeToggle = (): void => {
    this.colorScheme = this.colorScheme === "light" ? "dark" : "light";
    this.hasExplicitColorScheme = true;
    this.persistState();
    this.requestUpdate();
  };

  private getHomeModel(): HomeModel {
    const lastRuntimeEvent = this.flattenedEvents[0];
    return buildHomeModel({
      intelligenceConnected: Boolean(this._core?.intelligence),
      threadsAvailable: this.areThreadEndpointsAvailable(),
      metadata: this.inspectorMetadataProjection,
      runtimeUrl: this._core?.runtimeUrl,
      runtimeConnectionState: this.getCoreStatusSummary().state,
      lastRuntimeEvent: lastRuntimeEvent
        ? {
            id: lastRuntimeEvent.id,
            agentId: lastRuntimeEvent.agentId,
            type: lastRuntimeEvent.type,
            timestamp: lastRuntimeEvent.timestamp,
          }
        : undefined,
      // `available` begins optimistic inside the lazy Memory store. Until the
      // first capability probe has actually settled, showing Learning as on
      // would be a false positive that corrects itself only after navigation.
      memoriesOn:
        this.learning.memorySubscribed &&
        !this.learning.memoriesLoading &&
        this.learning.memoriesAvailable,
      a2uiOn: this._core?.a2uiEnabled === true,
      openGenUiOn: this._core?.openGenerativeUIEnabled === true,
      suggestionsOn: this._core?.suggestions === true,
      audioOn: this._core?.audioFileTranscriptionEnabled === true,
      websocketUrl: this._core?.intelligence?.wsUrl,
      intelligenceSignupUrl: this.getIntelligenceSignupUrl(),
    });
  }

  private renderHomeView() {
    const model = this.getHomeModel();
    const announcementPreview =
      this.newsSignalArmed && this.announcement
        ? renderAnnouncementPreview(
            this.announcement,
            () => this.handleMenuSelect(WHATS_NEW_MENU_KEY),
            (name) => this.renderIcon(name),
          )
        : undefined;
    return renderHomeDomainView(
      model,
      {
        copyFeaturePrompt: (service, event) => {
          void this.handleHomeFeaturePromptCopy(service, event);
        },
        openHeroAction: (action) => this.handleHomeHeroCta(action),
        openLastEvent: (eventId, agentId) =>
          this.handleHomeLastEventSelect(eventId, agentId),
      },
      {
        announcementPreview,
        appendRefParam: (href, ref) => this.appendRefParam(href, ref),
        featurePromptCopyState: (serviceId) =>
          homeFeaturePromptCopyState(this.homeFeatureSetup, serviceId),
        renderIcon: (name) => this.renderIcon(name),
      },
    );
  }

  private renderWhatsNewView() {
    return renderAnnouncementsView(
      this.announcement,
      this.announcementLoaded,
      this.handleAnnouncementContentClick,
    );
  }

  private renderEventErrorBanner(key: InspectorEventErrorSource) {
    const error = this.eventErrorDetails[key];
    if (!error) return nothing;
    const guide = EVENT_ERROR_GUIDANCE[key];
    return html`
      <div role="alert">
        <button
          type="button"
          class="live-inspection-control mx-3 mt-3 flex w-[calc(100%-1.5rem)] cursor-pointer items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left text-[11px] text-rose-950"
          data-cpk-event-error=${key}
          @click=${this.refocusEventErrorLanding}
        >
          <span aria-hidden="true" class="mt-0.5 shrink-0"
            >${this.renderIcon("TriangleAlert")}</span
          >
          <span class="min-w-0 flex-1 space-y-1">
            <span class="block font-semibold">${guide.title}</span>
            ${
              error.agentId
                ? html`<span class="block">Agent: ${error.agentId}</span>`
                : nothing
            }
            ${
              error.toolName
                ? html`<span class="block">Tool: ${error.toolName}</span>`
                : nothing
            }
            <span class="block break-words leading-relaxed"
              >${error.message}</span
            >
            ${
              guide.advice
                ? html`<span class="block leading-relaxed">${guide.advice}</span>`
                : nothing
            }
            ${
              guide.highlight && this.hasEventErrorHighlight(key)
                ? html`<span class="block leading-relaxed"
                  >${guide.highlight}</span
                >`
                : nothing
            }
          </span>
        </button>
      </div>
    `;
  }

  /** Scroll the landing view to the failed tool call or RUN_ERROR again. */
  private refocusEventErrorLanding = (event: Event): void => {
    const key = (event.currentTarget as HTMLElement | null)?.dataset
      .cpkEventError;
    if (!key || !isEventErrorKey(key)) return;
    this.applyEventErrorLanding(key);
    this.requestUpdate();
  };

  private handleHomeLastEventSelect(eventId: string, agentId?: string): void {
    this.eventFilterText = "";
    this.eventTypeFilter = "all";
    this.selectedContext =
      agentId && this.contextOptions.some((option) => option.key === agentId)
        ? agentId
        : "all-agents";
    this.expandedRows.clear();
    this.expandedRows.add(eventId);
    this.handleMenuSelect("ag-ui-events");

    void this.updateComplete.then(() => {
      const row = Array.from(
        this.activeRoot.querySelectorAll<HTMLElement>(
          "[data-inspector-event-id]",
        ),
      ).find((candidate) => candidate.dataset.inspectorEventId === eventId);
      row?.scrollIntoView?.({ block: "center" });
    });
  }

  private handleHomeFeaturePromptCopy = async (
    service: HomeServiceTile,
    event?: Event,
  ): Promise<void> => {
    await copyHomeFeaturePrompt(this.homeFeatureSetup, service, {
      clipboard: this.getClipboard(event),
      createRunId: createOnboardingRunId,
      isConnected: () => this.isConnected,
      requestUpdate: () => this.requestUpdate(),
      trackClick: (serviceId, onboardingRunId) =>
        trackHomeFeaturePrompt(
          serviceId,
          onboardingRunId,
          this.core?.telemetryDisabled ?? false,
        ),
    });
  };

  private getHomeFeaturePromptTarget(
    serviceId: HomeServiceId,
  ): HomeServiceTile | undefined {
    return this.getHomeModel().services.find(
      (service) => service.id === serviceId,
    );
  }

  private renderFeatureSetupPrompt(
    serviceId: HomeServiceId,
    className: string,
  ): TemplateResult | typeof nothing {
    const service = this.getHomeFeaturePromptTarget(serviceId);
    if (!service) return nothing;
    return renderFeatureSetupPromptButton({
      service,
      copyState: homeFeaturePromptCopyState(
        this.homeFeatureSetup,
        service.id,
      ),
      className,
      copy: (event) => {
        void this.handleHomeFeaturePromptCopy(service, event);
      },
      renderIcon: (name) => this.renderIcon(name),
    });
  }

  private handleHomeHeroCta(action: HomeHeroAction): void {
    trackHomeAction(action, this.core?.telemetryDisabled ?? false);
  }

  /**
   * The install row: copy the prompt, or fall back to the signup page.
   *
   * The prompt is primary and the link is secondary, which is the inversion
   * this card exists for. Leaving for a signup page is where developers drop
   * out; pasting into the editor they are already in is not.
   *
   * No third-party coding-agent logos here, unlike the Intelligence app. That
   * app is a private hosted surface; this one is a published npm package
   * embedded in other people's sites, and shipping Anthropic's and OpenAI's
   * marks inside it is a trademark call that is not ours to make quietly. The
   * helper line names the agents in text instead.
   */
  private renderIntelligenceInstallActions(action?: HomeHeroAction) {
    const copied = this.promptCopyState === "copied";
    const failed = this.promptCopyState === "failed";
    return html`
      <div
        class="inspector-intelligence-install"
        data-copy-state=${this.promptCopyState}
      >
        ${
          // The two actions are two routes to the same outcome — let the coding
          // agent wire it up, or go and do it in the browser — so the
          // secondary names the alternative path rather than promising an
          // explainer. It used to read "What Intelligence does", which pointed
          // at intelligence.copilotkit.ai: a product and signup page, not an
          // explanation. Mis-promising a destination is a poor trade right at
          // the moment the card is asking to be trusted.
          //
          // One slot for the secondary message, and its content follows the
          // state: before the press the useful aside is the other route, after
          // it is "where to put it". Adding the instruction as a second row
          // instead pushed the action column past the band's 76px and shoved
          // the whole story down at the moment the developer had just acted.
          // Both are single lines, so swapping them cannot change the height.
          //
          // Secondary sits inside the row and the primary at the outer edge:
          // in a right-aligned group the filled button belongs on the outside,
          // not wedged between the heading and a link.
          this.promptCopyState === "idle"
            ? action
              ? html`
                  <a
                    class="inspector-intelligence-install-secondary"
                    data-inspector-home-intelligence-action=${action.kind}
                    href=${action.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Set Intelligence up yourself (opens in a new tab)"
                    style=${INTERACTIVE_FOCUS_BASE_STYLE}
                    @click=${() => this.handleHomeHeroCta(action)}
                  >
                    Set it up yourself ${this.renderIcon("ArrowUpRight")}
                  </a>
                `
              : nothing
            : html`
                <p
                  class="inspector-intelligence-install-hint"
                  data-tone=${failed ? "error" : "success"}
                  role="status"
                >
                  ${
                    failed
                      ? "Clipboard blocked — copy the prompt below."
                      : "Paste it into your coding agent."
                  }
                </p>
              `
        }
        <button
          type="button"
          class="inspector-intelligence-hud-action inspector-intelligence-install-copy"
          data-inspector-intelligence-copy-prompt
          aria-label=${
            copied
              ? "Install prompt copied to clipboard. Paste it into your coding agent."
              : "Copy the Intelligence install prompt"
          }
          style=${INTERACTIVE_FOCUS_BASE_STYLE}
          @click=${this.handleIntelligencePromptCopy}
        >
          ${this.renderIcon(copied ? "Check" : "ClipboardCopy")}
          ${copied ? "Prompt copied" : "Copy setup prompt"}
        </button>
      </div>
    `;
  }

  /** One run id per element lifetime; minted on first use, never rotated. */
  private getOnboardingRunId(): string {
    this.onboardingRunId ??= createOnboardingRunId();
    return this.onboardingRunId;
  }

  private handleIntelligencePromptCopy = async (
    event?: Event,
  ): Promise<void> => {
    // A second press restarts the clock rather than inheriting the first
    // press's countdown.
    this.clearIntelligencePromptReset();
    const runId = this.getOnboardingRunId();
    const clipboard = this.getClipboard(event);
    let outcome: "copied" | "failed" = "failed";

    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(createOnboardingPrompt(runId));
        outcome = "copied";
      } catch {
        outcome = "failed";
      }
    }

    if (!this.isConnected) {
      return;
    }

    this.promptCopyState = outcome;
    this.requestUpdate();

    if (outcome === "copied") {
      this.scheduleIntelligencePromptReset();
    }

    if (!this.core?.telemetryDisabled) {
      trackHomePromptCopied({ onboarding_run_id: runId, outcome });
    }
  };

  /**
   * Return the button and its secondary line to the idle state.
   *
   * Long enough to read six words, short enough that a developer who went to
   * their editor and came back — because the paste went somewhere wrong, or
   * the terminal is gone — finds a button that plainly invites a second press
   * rather than a spent one wearing a checkmark.
   *
   * Only the copied state resets. A failed copy has the prompt on screen for
   * manual selection, and yanking that away mid-drag would be worse than the
   * clipboard failing in the first place.
   */
  private scheduleIntelligencePromptReset(): void {
    this.clearIntelligencePromptReset();
    this.promptCopyResetTimer = setTimeout(() => {
      this.promptCopyResetTimer = null;
      if (!this.isConnected || this.promptCopyState !== "copied") {
        return;
      }
      this.promptCopyState = "idle";
      this.requestUpdate();
    }, PROMPT_COPY_RESET_MS);
  }

  private clearIntelligencePromptReset(): void {
    if (this.promptCopyResetTimer !== null) {
      clearTimeout(this.promptCopyResetTimer);
      this.promptCopyResetTimer = null;
    }
  }

  /**
   * The three-beat Intelligence story.
   *
   * Every beat is in the DOM at all times and switched by opacity, so the
   * strip never reflows and screen readers get one stable structure. The
   * caption is the live text; the beats themselves are decorative and hidden
   * from assistive tech, because reading out a mocked code listing helps
   * nobody.
   */
  /**
   * The rotating argument, paired to whatever the picture below is showing.
   *
   * Hidden from assistive tech: a sentence that replaces itself every few
   * seconds is noise in a screen reader, so the stable summary above carries
   * the message there instead. Both sentences are always in the DOM and only
   * their opacity changes, so the block cannot reflow and the card never jumps
   * height mid-loop.
   */
  /**
   * Where a slide sits relative to the one on screen.
   *
   * This is what makes the motion agree with the rail: the rail reads left to
   * right, so a slide that has not been reached yet waits to the right, and one
   * already passed leaves to the left. Deriving it from the indices rather than
   * remembering a direction means clicking backwards through the tabs animates
   * backwards for free, with no state to keep in sync. The loop's wrap from the
   * last tab to the first therefore reads as a rewind, which is what it is.
   */
  private intelligenceSlidePosition(index: number): string {
    if (index === this.intelStoryBeat) return "active";
    return index < this.intelStoryBeat ? "before" : "after";
  }

  /** Same rule, addressed by beat id, for the picture halves. */
  private intelligenceBeatPosition(beatId: string): string {
    return this.intelligenceSlidePosition(
      INTELLIGENCE_STORY_BEATS.findIndex((beat) => beat.id === beatId),
    );
  }

  private renderIntelligenceStoryCopy() {
    return html`
      <div
        class="inspector-intelligence-copy"
        data-inspector-intelligence-copy
        data-beat=${
          INTELLIGENCE_STORY_BEATS[this.intelStoryBeat]?.id ?? "threads"
        }
        aria-hidden="true"
      >
        ${INTELLIGENCE_STORY_BEATS.map(
          (beat, index) => html`
            <div
              class="inspector-intelligence-copy-slide"
              data-beat-id=${beat.id}
              data-active=${index === this.intelStoryBeat}
              data-position=${this.intelligenceSlidePosition(index)}
            >
              <strong>${beat.lead}</strong>
              <span>${beat.support}</span>
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderIntelligenceStory() {
    const activeBeat = INTELLIGENCE_STORY_BEATS[this.intelStoryBeat];
    return html`
      <section
        class="inspector-intelligence-story"
        data-inspector-intelligence-story
        data-beat=${activeBeat?.id ?? "threads"}
      >
        ${this.renderIntelligenceStoryCopy()}
        <div class="inspector-intelligence-story-stage" aria-hidden="true">
          ${this.renderIntelligenceStoryThreads()}
          ${this.renderIntelligenceStoryLearning()}
          ${this.renderIntelligenceStorySkill()}
          ${this.renderIntelligenceStoryReuse()}
        </div>
        <div
          class="inspector-intelligence-story-rail"
          role="tablist"
          aria-label="What Intelligence adds"
        >
          ${INTELLIGENCE_STORY_BEATS.map(
            (beat, index) => html`
              <button
                type="button"
                role="tab"
                class="inspector-intelligence-story-tab"
                aria-selected=${index === this.intelStoryBeat}
                data-active=${index === this.intelStoryBeat}
                style=${INTERACTIVE_FOCUS_BASE_STYLE}
                @click=${() => this.pinIntelligenceStoryBeat(index)}
              >
                ${beat.label}
              </button>
            `,
          )}
        </div>
      </section>
    `;
  }

  /** Beat 1 — the developer's own users' conversations, one of them broken. */
  private renderIntelligenceStoryThreads() {
    return html`
      <div
        class="inspector-intelligence-beat"
        data-beat-id="threads"
        data-position=${this.intelligenceBeatPosition("threads")}
      >
        <div class="inspector-intelligence-threads">
          ${INTELLIGENCE_STORY_THREADS.map(
            (thread, index) => html`
              <span
                class="inspector-intelligence-thread"
                data-failed=${thread.failed}
                style="--thread-index:${index}"
              >
                <i></i>
                <strong>${thread.title}</strong>
                <small>${thread.meta}</small>
              </span>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderIntelligenceStoryLearning() {
    return html`
      <div
        class="inspector-intelligence-beat"
        data-beat-id="learning"
        data-position=${this.intelligenceBeatPosition("learning")}
      >
        <div class="inspector-intelligence-beat-col">
          <span class="inspector-intelligence-beat-label">
            Signals from ${INTELLIGENCE_STORY_SIGNALS.length} threads
          </span>
          ${INTELLIGENCE_STORY_SIGNALS.map(
            (signal, index) => html`
              <span
                class="inspector-intelligence-signal"
                style="--signal-index:${index}"
                >${signal}</span
              >
            `,
          )}
        </div>
        <div class="inspector-intelligence-beat-flow">
          ${this.renderIcon("ArrowRight")}
        </div>
        <div class="inspector-intelligence-beat-col">
          <span class="inspector-intelligence-beat-label">
            Reusable pattern
          </span>
          ${INTELLIGENCE_STORY_RULES.map(
            (rule, index) => html`
              <span
                class="inspector-intelligence-rule"
                style="--rule-index:${index}"
              >
                <i>${this.renderIcon("Check")}</i>${rule}
              </span>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderIntelligenceStorySkill() {
    return html`
      <div
        class="inspector-intelligence-beat"
        data-beat-id="skill"
        data-position=${this.intelligenceBeatPosition("skill")}
      >
        <div class="inspector-intelligence-skill-file">
          <header>
            ${this.renderIcon("FileText")}
            <strong>${INTELLIGENCE_STORY_SKILL_FILE}</strong>
            <em>Pending review</em>
          </header>
          <div class="inspector-intelligence-skill-code">
            <span data-line="1"><b># Meeting scheduling</b></span>
            <span data-line="2">When planning a meeting:</span>
            ${INTELLIGENCE_STORY_RULES.map(
              (rule, index) => html`
                <span data-line=${index + 3} style="--rule-index:${index}"
                  >${index + 1}. ${rule}</span
                >
              `,
            )}
          </div>
        </div>
      </div>
    `;
  }

  private renderIntelligenceStoryReuse() {
    return html`
      <div
        class="inspector-intelligence-beat"
        data-beat-id="intelligence"
        data-position=${this.intelligenceBeatPosition("intelligence")}
      >
        <div class="inspector-intelligence-chain">
          ${INTELLIGENCE_STORY_CHAIN.map(
            (step, index) => html`
              <span
                class="inspector-intelligence-chain-step"
                style="--step-index:${index}"
              >
                <i>${this.renderIcon(step.icon as LucideIconName)}</i>
                <strong>${step.name}</strong>
                <small>${step.detail}</small>
              </span>
              ${
                index === INTELLIGENCE_STORY_CHAIN.length - 1
                  ? nothing
                  : html`
                    <span
                      class="inspector-intelligence-chain-arrow"
                      style="--step-index:${index}"
                      >${this.renderIcon("ChevronRight")}</span
                    >
                  `
              }
            `,
          )}
        </div>
        <span class="inspector-intelligence-chain-proof">
          ${this.renderIcon("Sparkles")} Next run starts with
          <code>${INTELLIGENCE_STORY_SKILL_FILE}</code>
        </span>
      </div>
    `;
  }

  /** A press pins that beat and stops the loop; the developer is now driving. */
  private pinIntelligenceStoryBeat(index: number): void {
    this.intelStoryUserPinned = true;
    this.intelStoryBeat = index;
    this.stopIntelligenceStory();
    this.requestUpdate();

    // Reported here and nowhere else: this is the only path a human can take
    // to a beat. The auto-advance in syncIntelligenceStory deliberately stays
    // silent.
    if (!this.core?.telemetryDisabled) {
      const beat = INTELLIGENCE_STORY_BEATS[index];
      if (beat) {
        trackHomeStoryBeatSelected({ beat: beat.id, beat_index: index });
      }
    }
  }

  /**
   * Advance the story only while it is actually on screen.
   *
   * Gated on the panel being open, Home being the visible tab, settings being
   * closed and the document being visible. Anything less and a debugging tool
   * would be holding a repeating timer behind a closed panel.
   */
  private syncIntelligenceStory(): void {
    const visible =
      this.isOpen &&
      !this.settingsOpen &&
      this.selectedMenu === "home" &&
      !this._core?.intelligence &&
      typeof document !== "undefined" &&
      document.visibilityState !== "hidden";

    if (!visible) {
      // Leaving Home also releases a pinned beat, so coming back later shows a
      // running story rather than a frozen one that reads as broken.
      this.intelStoryUserPinned = false;
      this.stopIntelligenceStory();
      return;
    }

    if (this.intelStoryUserPinned || this.prefersReducedMotion()) {
      this.stopIntelligenceStory();
      return;
    }

    if (this.intelStoryTimer !== null) {
      return;
    }

    const advance = (): void => {
      const current = INTELLIGENCE_STORY_BEATS[this.intelStoryBeat];
      this.intelStoryTimer = setTimeout(() => {
        this.intelStoryTimer = null;
        if (!this.isConnected) {
          return;
        }
        this.intelStoryBeat =
          (this.intelStoryBeat + 1) % INTELLIGENCE_STORY_BEATS.length;
        this.requestUpdate();
        advance();
      }, current?.duration ?? 3_800);
    };

    advance();
  }

  private stopIntelligenceStory(): void {
    if (this.intelStoryTimer !== null) {
      clearTimeout(this.intelStoryTimer);
      this.intelStoryTimer = null;
    }
  }

  /**
   * Reduced motion parks the story on the closing beat.
   *
   * That beat is the whole argument in one static frame, so a developer who
   * asked their OS for less motion still gets the point rather than a
   * fragment of it.
   */
  private prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) {
      return false;
    }
    this.intelStoryReducedMotion ??= window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    if (this.intelStoryReducedMotion.matches) {
      this.intelStoryBeat = INTELLIGENCE_STORY_BEATS.length - 1;
      return true;
    }
    return false;
  }

  private maybeTrackHomeViewed(): void {
    if (this.selectedMenu !== "home" || this.settingsOpen || !this.isOpen) {
      return;
    }
    if (!this.homeViewedThisOpen && !this.core?.telemetryDisabled) {
      this.homeViewedThisOpen = true;
      trackHomeView(false);
    }
  }

  private renderWindow() {
    const windowState = this.contextState.window;
    const isDocked = this.dockMode !== "floating";
    const isPoppedOut = this.isPoppedOut;
    const isTransitioning = this.hasAttribute("data-transitioning");
    const disableDrag = isDocked || isPoppedOut;

    const windowStyles = isPoppedOut
      ? {
          position: "fixed",
          inset: "0",
          width: "100%",
          height: "100%",
          minWidth: "0",
          minHeight: "0",
          borderRadius: "0",
          overflowX: "hidden",
        }
      : isDocked
        ? { ...this.getDockedWindowStyles(), overflowX: "hidden" }
        : {
            width: `${Math.round(windowState.size.width)}px`,
            height: `${Math.round(windowState.size.height)}px`,
            minWidth: `${MIN_WINDOW_WIDTH}px`,
            minHeight: `${MIN_WINDOW_HEIGHT}px`,
            overflowX: "hidden",
          };

    const hasContextDropdown = this.contextOptions.some(
      (option) => option.key !== "all-agents",
    );
    const viewportWidth = isPoppedOut
      ? (this.popOut?.win.innerWidth ?? windowState.size.width)
      : typeof window === "undefined"
        ? windowState.size.width
        : window.innerWidth;
    const automaticallyCollapsed = shouldUseIconRail({
      dockedLeft: this.dockMode === "docked-left",
      width: viewportWidth,
    });
    const iconRail = this.sidebarCollapsed || automaticallyCollapsed;
    const contextDropdown = hasContextDropdown
      ? this.renderLiveContextDropdown(iconRail)
      : nothing;
    const agentSelector = hasContextDropdown
      ? contextDropdown
      : html`
          <div
            class="inspector-agent-placeholder flex items-center gap-2 rounded-md border border-dashed px-2 py-1 text-xs"
          >
            <span>${this.renderIcon("Bot")}</span>
            <span class="truncate">No agents available</span>
          </div>
        `;

    return html`
      <section
        class="inspector-window pointer-events-auto relative flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-lg"
        style=${styleMap(windowStyles)}
        data-docked=${isDocked}
        data-transitioning=${isTransitioning}
        data-color-scheme=${this.colorScheme}
      >
        ${
          isDocked && !isPoppedOut
            ? html`
              <div
                class="dock-resize-handle pointer-events-auto"
                data-resize-edge="e"
                role="presentation"
                aria-hidden="true"
                @pointerdown=${this.handleResizePointerDown}
                @pointermove=${this.handleResizePointerMove}
                @pointerup=${this.handleResizePointerUp}
                @pointercancel=${this.handleResizePointerCancel}
              ></div>
            `
            : nothing
        }
        <div
          class="flex flex-1 flex-col overflow-hidden bg-white text-gray-800"
        >
          <div
            class="drag-handle relative z-30 flex flex-col border-b border-gray-200 bg-white/95 backdrop-blur-sm ${
              disableDrag
                ? ""
                : this.isDragging && this.pointerContext === "window"
                  ? "cursor-grabbing"
                  : "cursor-grab"
            }"
            data-drag-context="window"
            @pointerdown=${disableDrag ? undefined : this.handlePointerDown}
            @pointermove=${disableDrag ? undefined : this.handlePointerMove}
            @pointerup=${disableDrag ? undefined : this.handlePointerUp}
            @pointercancel=${disableDrag ? undefined : this.handlePointerCancel}
          >
            <div
              class="inspector-account-strip flex flex-wrap items-center gap-3 px-3 py-2"
              data-inspector-account-strip
              style="width:100%;min-width:0;color:#010507;"
            >
              <div class="inspector-account-brand flex items-center min-w-0">
                <img
                  src=${inspectorLogoUrl}
                  alt="CopilotKit"
                  class="inspector-account-logo h-6 w-auto"
                  loading="lazy"
                />
                <img
                  src=${inspectorLogoUrl}
                  alt=""
                  aria-hidden="true"
                  class="inspector-account-logo-accent h-6 w-auto"
                  loading="lazy"
                />
              </div>
              <div class="ml-auto flex min-w-0 items-center gap-2">
                <a
                  class="inspector-account-cta"
                  data-inspector-thread-cta
                  data-motion-paused=${
                    this.accountCtaMotionPaused ? "true" : "false"
                  }
                  href=${this.getThreadsTalkToEngineerUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Talk to an Engineer (opens in a new tab)"
                  title="Talk to an Engineer"
                  style=${INTERACTIVE_FOCUS_BASE_STYLE}
                  @click=${this.handleTalkToEngineerClick}
                >
                  <span aria-hidden="true"
                    >${this.renderIcon("MessageCircle")}</span
                  >
                  <span class="inspector-account-cta-label"
                    >Talk to an Engineer</span
                  >
                </a>
                <div class="flex items-center gap-1">
                  ${isPoppedOut ? nothing : this.renderWindowLayoutMenu()}
                  <button
                    class="inspector-account-control flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    type="button"
                    aria-label=${
                      this.colorScheme === "light"
                        ? "Switch to dark mode"
                        : "Switch to light mode"
                    }
                    aria-pressed=${this.colorScheme === "dark"}
                    title=${
                      this.colorScheme === "light" ? "Dark mode" : "Light mode"
                    }
                    data-inspector-theme-toggle
                    style=${INTERACTIVE_FOCUS_BASE_STYLE}
                    @click=${this.handleColorSchemeToggle}
                  >
                    <span
                      class="inspector-account-control-icon"
                      aria-hidden="true"
                    >
                      ${this.renderIcon(
                        this.colorScheme === "light" ? "Moon" : "Sun",
                      )}
                    </span>
                  </button>
                  <button
                    class="inspector-account-control flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      this.settingsOpen
                        ? "inspector-account-control-active"
                        : ""
                    }"
                    type="button"
                    aria-label="Settings"
                    aria-pressed=${this.settingsOpen}
                    title="Settings"
                    style=${INTERACTIVE_FOCUS_BASE_STYLE}
                    @click=${this.handleSettingsToggle}
                  >
                    <span
                      class="inspector-account-control-icon"
                      aria-hidden="true"
                    >
                      ${this.renderIcon("Settings")}
                    </span>
                  </button>
                  ${
                    isPoppedOut
                      ? nothing
                      : html`
                        <button
                          class="inspector-account-control flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                          type="button"
                          aria-label="Close Web Inspector"
                          style=${INTERACTIVE_FOCUS_BASE_STYLE}
                          @pointerdown=${this.handleClosePointerDown}
                          @click=${this.handleCloseClick}
                        >
                          ${this.renderIcon("X")}
                        </button>
                      `
                  }
                </div>
              </div>
            </div>
          </div>
          <div class="inspector-shell">
            ${this.renderInspectorSidebar(
              iconRail,
              automaticallyCollapsed,
              agentSelector,
            )}
            <div class="inspector-main">
              <div id="cpk-main-scroll" class="flex-1 overflow-auto">
                ${this.renderCoreWarningBanner()} ${this.renderMainContent()}
                <slot></slot>
              </div>
            </div>
          </div>
        </div>
        ${
          isPoppedOut
            ? nothing
            : html`
              ${
                isDocked
                  ? nothing
                  : html`
                    <div
                      class="edge-resize-handle edge-resize-handle-w pointer-events-auto"
                      data-resize-edge="w"
                      role="presentation"
                      aria-hidden="true"
                      @pointerdown=${this.handleResizePointerDown}
                      @pointermove=${this.handleResizePointerMove}
                      @pointerup=${this.handleResizePointerUp}
                      @pointercancel=${this.handleResizePointerCancel}
                    ></div>
                    <div
                      class="edge-resize-handle edge-resize-handle-e pointer-events-auto"
                      data-resize-edge="e"
                      role="presentation"
                      aria-hidden="true"
                      @pointerdown=${this.handleResizePointerDown}
                      @pointermove=${this.handleResizePointerMove}
                      @pointerup=${this.handleResizePointerUp}
                      @pointercancel=${this.handleResizePointerCancel}
                    ></div>
                    <div
                      class="edge-resize-handle edge-resize-handle-s pointer-events-auto"
                      data-resize-edge="s"
                      role="presentation"
                      aria-hidden="true"
                      @pointerdown=${this.handleResizePointerDown}
                      @pointermove=${this.handleResizePointerMove}
                      @pointerup=${this.handleResizePointerUp}
                      @pointercancel=${this.handleResizePointerCancel}
                    ></div>
                  `
              }
              <div
                class="resize-handle pointer-events-auto absolute bottom-0 right-0 flex h-7 w-7 cursor-nwse-resize items-center justify-center text-gray-600 transition hover:text-gray-900"
                data-resize-edge="se"
                role="presentation"
                aria-hidden="true"
                @pointerdown=${this.handleResizePointerDown}
                @pointermove=${this.handleResizePointerMove}
                @pointerup=${this.handleResizePointerUp}
                @pointercancel=${this.handleResizePointerCancel}
              >
                <svg
                  class="h-3 w-3"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-width="1.5"
                >
                  <path d="M5 15L15 5" />
                  <path d="M9 15L15 9" />
                </svg>
              </div>
            `
        }
      </section>
    `;
  }

  private hydrateStateFromStorageEarly(): void {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const persisted = loadInspectorState(INSPECTOR_STORAGE_KEY);
    this.hydrateColorSchemePreference(persisted);
    if (!persisted) {
      return;
    }

    // Restore the open/closed state
    if (typeof persisted.isOpen === "boolean") {
      this.isOpen = persisted.isOpen;
    }

    // Restore the dock mode
    if (isValidDockMode(persisted.dockMode)) {
      this.dockMode = persisted.dockMode;
    }

    this.restorePersistedMenu(
      persisted.selectedMenu,
      persisted.hasOpenedInspector === true,
    );
    if (this.isOpen) {
      this.hasOpenedInspector = true;
    }
    if (typeof persisted.sidebarCollapsed === "boolean") {
      this.sidebarCollapsed = persisted.sidebarCollapsed;
    }
    // Restore selected context (agent), will be validated later against available agents
    if (typeof persisted.selectedContext === "string") {
      this.selectedContext = persisted.selectedContext;
      this.pendingSelectedContext = persisted.selectedContext;
    }
  }

  private hydrateStateFromStorage(): void {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const persisted = loadInspectorState(INSPECTOR_STORAGE_KEY);
    this.hydrateColorSchemePreference(persisted);
    if (!persisted) {
      return;
    }

    this.restorePersistedMenu(
      persisted.selectedMenu,
      persisted.hasOpenedInspector === true,
    );
    if (this.isOpen) {
      this.hasOpenedInspector = true;
    }

    const persistedButton = persisted.button;
    if (persistedButton) {
      if (isValidAnchor(persistedButton.anchor)) {
        this.contextState.button.anchor = persistedButton.anchor;
      }

      if (isValidPosition(persistedButton.anchorOffset)) {
        this.contextState.button.anchorOffset = persistedButton.anchorOffset;
      }

      if (typeof persistedButton.hasCustomPosition === "boolean") {
        this.hasCustomPosition.button = persistedButton.hasCustomPosition;
      }
    }

    const persistedWindow = persisted.window;
    if (persistedWindow) {
      if (isValidAnchor(persistedWindow.anchor)) {
        this.contextState.window.anchor = persistedWindow.anchor;
      }

      if (isValidPosition(persistedWindow.anchorOffset)) {
        this.contextState.window.anchorOffset = persistedWindow.anchorOffset;
      }

      if (isValidSize(persistedWindow.size)) {
        // Now clampWindowSize will use the correct minimum based on dockMode
        this.contextState.window.size = this.clampWindowSize(
          persistedWindow.size,
        );
      }

      if (typeof persistedWindow.hasCustomPosition === "boolean") {
        this.hasCustomPosition.window = persistedWindow.hasCustomPosition;
      }
    }

    if (typeof persisted.selectedContext === "string") {
      this.selectedContext = persisted.selectedContext;
      this.pendingSelectedContext = persisted.selectedContext;
    }
    if (typeof persisted.sidebarCollapsed === "boolean") {
      this.sidebarCollapsed = persisted.sidebarCollapsed;
    }
  }

  /** Follow the OS preference until a person deliberately picks a theme. */
  private hydrateColorSchemePreference(persisted: PersistedState | null): void {
    const preference = persisted?.colorSchemePreference;
    if (preference === "light" || preference === "dark") {
      this.hasExplicitColorScheme = true;
      this.colorScheme = preference;
      return;
    }

    this.hasExplicitColorScheme = false;
    this.colorScheme = this.getSystemColorScheme();
  }

  private getSystemColorScheme(): InspectorColorScheme {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  private readonly handleSystemColorSchemeChange = (
    event: MediaQueryListEvent,
  ): void => {
    if (this.hasExplicitColorScheme) {
      return;
    }
    this.colorScheme = event.matches ? "dark" : "light";
    this.requestUpdate();
  };

  private subscribeToSystemColorScheme(): void {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery || mediaQuery === this.systemColorSchemeMediaQuery) {
      return;
    }

    this.unsubscribeFromSystemColorScheme();
    this.systemColorSchemeMediaQuery = mediaQuery;
    mediaQuery.addEventListener?.("change", this.handleSystemColorSchemeChange);
  }

  private unsubscribeFromSystemColorScheme(): void {
    this.systemColorSchemeMediaQuery?.removeEventListener?.(
      "change",
      this.handleSystemColorSchemeChange,
    );
    this.systemColorSchemeMediaQuery = null;
  }

  /** Restore a visible leaf, or open Home for first install and stale state. */
  private restorePersistedMenu(
    value: unknown,
    hasOpenedInspector = this.hasOpenedInspector,
  ): void {
    this.hasOpenedInspector = hasOpenedInspector;
    this.pendingPersistedMenu = null;
    this.briefingRestoreMenu = null;

    const storedMenu = isInspectorMenuKey(value) ? value : null;
    const visibleMenu =
      storedMenu && this.menuItems.some((item) => item.key === storedMenu)
        ? storedMenu
        : null;

    this.selectedMenu = "home";
    this.lastSelectedMenuByGroup.home = "home";

    if (!hasOpenedInspector) {
      if (visibleMenu && visibleMenu !== "home") {
        this.briefingRestoreMenu = visibleMenu;
        this.lastSelectedMenuByGroup[getGroupForMenu(visibleMenu)] =
          visibleMenu;
      } else if (storedMenu && !visibleMenu && !this.hasResolvedCore) {
        this.pendingPersistedMenu = storedMenu;
      }
      return;
    }

    if (!storedMenu) {
      return;
    }

    if (!visibleMenu) {
      if (!this.hasResolvedCore) {
        this.pendingPersistedMenu = storedMenu;
      }
      return;
    }

    this.selectedMenu = visibleMenu;
    this.lastSelectedMenuByGroup[getGroupForMenu(visibleMenu)] = visibleMenu;
  }

  /** Resolve a valid stored leaf after the first Core exposes its sources. */
  private resolvePendingPersistedMenu(): void {
    const pendingMenu = this.pendingPersistedMenu;
    if (!pendingMenu) {
      return;
    }

    this.pendingPersistedMenu = null;
    this.restorePersistedMenu(pendingMenu, this.hasOpenedInspector);
    this.persistState();
  }

  private get activeContext(): ContextKey {
    return this.isOpen ? "window" : "button";
  }

  private handlePointerDown = (event: PointerEvent) => {
    // Don't allow dragging when docked
    if (this.dockMode !== "floating" && this.isOpen) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    const contextAttr = target?.dataset.dragContext;
    const context: ContextKey = contextAttr === "window" ? "window" : "button";

    const eventTarget = event.target as HTMLElement | null;
    if (context === "window" && eventTarget?.closest("button, a, nav")) {
      return;
    }

    this.pointerContext = context;
    this.measureContext(context);

    event.preventDefault();

    this.pointerId = event.pointerId;
    this.dragStart = { x: event.clientX, y: event.clientY };
    const state = this.contextState[context];
    this.dragOffset = {
      x: event.clientX - state.position.x,
      y: event.clientY - state.position.y,
    };
    this.isDragging = false;
    this.draggedDuringInteraction = false;
    this.ignoreNextButtonClick = false;

    target?.setPointerCapture?.(this.pointerId);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (
      this.pointerId !== event.pointerId ||
      !this.dragStart ||
      !this.pointerContext
    ) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - this.dragStart.x,
      event.clientY - this.dragStart.y,
    );
    if (!this.isDragging && distance < DRAG_THRESHOLD) {
      return;
    }

    event.preventDefault();
    this.setDragging(true);
    this.draggedDuringInteraction = true;

    const desired: Position = {
      x: event.clientX - this.dragOffset.x,
      y: event.clientY - this.dragOffset.y,
    };

    const constrained = this.constrainToViewport(desired, this.pointerContext);
    this.contextState[this.pointerContext].position = constrained;
    this.updateHostTransform(this.pointerContext);
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.pointerId)) {
      target.releasePointerCapture(this.pointerId);
    }

    const context = this.pointerContext ?? this.activeContext;

    if (this.isDragging && this.pointerContext) {
      event.preventDefault();
      this.setDragging(false);
      if (this.pointerContext === "window") {
        this.updateAnchorFromPosition(this.pointerContext);
        this.hasCustomPosition.window = true;
        this.applyAnchorPosition(this.pointerContext);
      } else if (this.pointerContext === "button") {
        // Snap button to nearest corner
        this.snapButtonToCorner();
        this.hasCustomPosition.button = true;
        if (this.draggedDuringInteraction) {
          this.ignoreNextButtonClick = true;
        }
      }
    } else if (
      context === "button" &&
      !this.isOpen &&
      !this.draggedDuringInteraction
    ) {
      // Pointer events fire before `click`, so a mouse press opens from here
      // and never reaches handleButtonClick. Both paths must behave the same.
      this.openInspector("floating_button");
    }

    this.resetPointerTracking();
  };

  private handlePointerCancel = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.pointerId)) {
      target.releasePointerCapture(this.pointerId);
    }

    this.resetPointerTracking();
  };

  private handleButtonClick = (event: Event) => {
    if (this.isDragging) {
      event.preventDefault();
      return;
    }

    if (this.ignoreNextButtonClick) {
      event.preventDefault();
      this.ignoreNextButtonClick = false;
      return;
    }

    if (!this.isOpen) {
      event.preventDefault();
      // Reached by keyboard activation, which fires `click` with no pointer
      // events. A mouse press has already opened from handlePointerUp.
      this.openInspector("floating_button");
    }
  };

  private handleClosePointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  private handleCloseClick = () => {
    this.closeInspector();
  };

  private get isPoppedOut(): boolean {
    return this.popOut !== null && !this.popOut.win.closed;
  }

  private get activeRoot(): ParentNode {
    if (this.isPoppedOut) {
      return this.popOut!.win.document;
    }
    return this.renderRoot;
  }

  private getPopOutCssTexts(): string[] {
    const fromStatic = WebInspectorElement.styles.map((sheet) =>
      "cssText" in sheet ? String(sheet.cssText) : "",
    );
    const overlay = `
    html, body { margin: 0; height: 100%; background: #ffffff; }
    .inspector-window {
      position: fixed !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      border-radius: 0 !important;
    }
  `;
    return [...fromStatic.filter(Boolean), overlay];
  }

  // Also bound as button.click so a blocked popup throws out of element.click().
  // jsdom swallows errors from click event listeners.
  private getRenderedInspectorWindowSize(): Size {
    const inspectorWindow =
      this.shadowRoot?.querySelector<HTMLElement>(".inspector-window");
    if (inspectorWindow) {
      const width = Math.round(Number.parseFloat(inspectorWindow.style.width));
      const height = Math.round(
        Number.parseFloat(inspectorWindow.style.height),
      );
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height };
      }
    }
    return this.clampWindowSize(this.contextState.window.size);
  }

  private requestPopOut = (): void => {
    if (this.isPoppedOut) return;
    this.layoutMenuOpen = false;
    this.requestUpdate();
    const size = this.getRenderedInspectorWindowSize();
    const handle = openPopOutWindow({
      open: window.open.bind(window),
      features: buildPopOutFeatures(size),
      title: "CopilotKit Inspector",
      cssTexts: this.getPopOutCssTexts(),
      sourceDocument: document,
      onClose: () => this.handlePopOutClosed(),
    });
    this.popOut = handle;
    try {
      defineWebInspector(handle.win.customElements);
      if (this.dockMode !== "floating") {
        this.removeDockStyles();
      }
      handle.win.addEventListener(
        "pointerdown",
        this.handleGlobalPointerDown as EventListener,
      );
      this.syncInspectorPortal();
      this.requestUpdate();
    } catch (error) {
      this.popOut = null;
      this.unbindPopOutPointerDown(handle.win);
      handle.close();
      if (this.isConnected && this.isOpen && this.dockMode !== "floating") {
        this.applyDockStyles();
      }
      this.requestUpdate();
      throw error;
    }
  };

  private unbindPopOutPointerDown(win: Window): void {
    try {
      win.removeEventListener(
        "pointerdown",
        this.handleGlobalPointerDown as EventListener,
      );
    } catch {
      // Popup window may already be gone.
    }
  }

  private handlePopOutClosed = (): void => {
    const handle = this.popOut;
    if (!handle) return;
    this.popOut = null;
    this.unbindPopOutPointerDown(handle.win);
    this.syncInspectorPortal();
    if (this.isConnected && this.isOpen && this.dockMode !== "floating") {
      this.applyDockStyles();
    }
    this.requestUpdate();
  };

  private closePopOut(): void {
    const handle = this.popOut;
    if (!handle) return;
    this.handlePopOutClosed();
    handle.close();
  }

  private handleAppBeforeUnload = (): void => {
    this.closePopOut();
  };

  private syncInspectorPortal(): void {
    if (!this.inspectorPortal) {
      const portal = (this.ownerDocument ?? document).createElement("div");
      portal.dataset.inspectorPortal = "true";
      portal.style.display = "contents";
      this.inspectorPortal = portal;
    }

    if (!this.isOpen) {
      render(nothing, this.inspectorPortal, {
        host: this,
        creationScope: this.ownerDocument ?? document,
      });
      this.inspectorPortal.remove();
      return;
    }

    render(this.renderWindow(), this.inspectorPortal, {
      host: this,
      creationScope: this.ownerDocument ?? document,
    });

    const target = this.isPoppedOut
      ? this.popOut!.win.document.body
      : this.renderRoot.querySelector<HTMLElement>(
          "[data-inspector-portal-anchor]",
        );
    if (target && this.inspectorPortal.parentNode !== target) {
      target.appendChild(this.inspectorPortal);
    }
  }

  private handleResizePointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();

    this.hasCustomPosition.window = true;
    this.isResizing = true;
    this.resizePointerId = event.pointerId;
    this.resizeStart = { x: event.clientX, y: event.clientY };
    this.resizeInitialSize = { ...this.contextState.window.size };
    this.resizeInitialPosition = { ...this.contextState.window.position };
    const edge = (event.currentTarget as HTMLElement | null)?.dataset
      .resizeEdge;
    this.resizeEdge =
      edge === "w" ||
      edge === "e" ||
      edge === "s" ||
      edge === "se" ||
      edge === "sw"
        ? edge
        : "se";

    // Remove transition from body during resize to prevent lag
    if (document.body && this.dockMode !== "floating") {
      document.body.style.transition = "";
    }

    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);
  };

  private handleResizePointerMove = (event: PointerEvent) => {
    if (
      !this.isResizing ||
      this.resizePointerId !== event.pointerId ||
      !this.resizeStart ||
      !this.resizeInitialSize
    ) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - this.resizeStart.x;
    const deltaY = event.clientY - this.resizeStart.y;
    const state = this.contextState.window;
    const edge = this.resizeEdge;
    const growWest = edge === "w" || edge === "sw";
    const growEast =
      edge === "e" || edge === "se" || this.dockMode === "docked-left";
    const growSouth = edge === "s" || edge === "se" || edge === "sw";

    // For docked states, only resize in the appropriate dimension
    if (this.dockMode === "docked-left") {
      // Only resize width for left dock
      state.size = this.clampWindowSize({
        width: this.resizeInitialSize.width + deltaX,
        height: state.size.height,
      });
      // Update the body margin
      if (document.body) {
        document.body.style.marginLeft = `${state.size.width}px`;
      }
    } else {
      const initialSize = this.resizeInitialSize;
      const initialPos = this.resizeInitialPosition ?? { ...state.position };
      let nextWidth = initialSize.width;
      let nextHeight = initialSize.height;

      if (growEast) {
        nextWidth = initialSize.width + deltaX;
      } else if (growWest) {
        nextWidth = initialSize.width - deltaX;
      }
      if (growSouth) {
        nextHeight = initialSize.height + deltaY;
      }

      state.size = this.clampWindowSize({
        width: nextWidth,
        height: nextHeight,
      });

      if (growWest) {
        const right = initialPos.x + initialSize.width;
        state.position = {
          x: right - state.size.width,
          y: initialPos.y,
        };
      }

      this.keepPositionWithinViewport("window");
      this.updateAnchorFromPosition("window");
    }

    this.requestUpdate();
    this.updateHostTransform("window");
  };

  private handleResizePointerUp = (event: PointerEvent) => {
    if (this.resizePointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.resizePointerId)) {
      target.releasePointerCapture(this.resizePointerId);
    }

    // Only update anchor position for floating mode
    if (this.dockMode === "floating") {
      this.updateAnchorFromPosition("window");
      this.applyAnchorPosition("window");
    }

    // Persist the new size after resize completes
    this.persistState();
    this.resetResizeTracking();
  };

  private handleResizePointerCancel = (event: PointerEvent) => {
    if (this.resizePointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.resizePointerId)) {
      target.releasePointerCapture(this.resizePointerId);
    }

    // Only update anchor position for floating mode
    if (this.dockMode === "floating") {
      this.updateAnchorFromPosition("window");
      this.applyAnchorPosition("window");
    }

    // Persist the new size after resize completes
    this.persistState();
    this.resetResizeTracking();
  };

  private handleResize = () => {
    if (this.isPoppedOut) {
      return;
    }
    this.measureContext("button");
    this.applyAnchorPosition("button");

    this.measureContext("window");
    this.contextState.window.size = this.clampWindowSize(
      this.contextState.window.size,
    );
    if (this.hasCustomPosition.window) {
      this.applyAnchorPosition("window");
    } else {
      this.centerContext("window");
    }

    this.requestUpdate();
    this.updateHostTransform();
  };

  private measureContext(context: ContextKey): void {
    const selector =
      context === "window" ? ".inspector-window" : ".console-button";
    const element = this.renderRoot?.querySelector(
      selector,
    ) as HTMLElement | null;
    if (!element) {
      return;
    }
    const fallback =
      context === "window" ? DEFAULT_WINDOW_SIZE : DEFAULT_BUTTON_SIZE;
    updateSizeFromElement(this.contextState[context], element, fallback);
  }

  private centerContext(context: ContextKey): void {
    if (typeof window === "undefined") {
      return;
    }

    const viewport = this.getViewportSize();
    centerContextHelper(this.contextState[context], viewport, EDGE_MARGIN);

    if (context === this.activeContext) {
      this.updateHostTransform(context);
    }

    this.hasCustomPosition[context] = false;
    this.persistState();
  }

  private ensureWindowPlacement(): void {
    if (typeof window === "undefined") {
      return;
    }

    if (!this.hasCustomPosition.window) {
      this.centerContext("window");
      return;
    }

    const viewport = this.getViewportSize();
    keepPositionWithinViewport(this.contextState.window, viewport, EDGE_MARGIN);
    updateAnchorFromPositionHelper(
      this.contextState.window,
      viewport,
      EDGE_MARGIN,
    );
    this.updateHostTransform("window");
    this.persistState();
  }

  private constrainToViewport(
    position: Position,
    context: ContextKey,
  ): Position {
    if (typeof window === "undefined") {
      return position;
    }

    const viewport = this.getViewportSize();
    return constrainToViewport(
      this.contextState[context],
      position,
      viewport,
      EDGE_MARGIN,
    );
  }

  private keepPositionWithinViewport(context: ContextKey): void {
    if (typeof window === "undefined") {
      return;
    }

    const viewport = this.getViewportSize();
    keepPositionWithinViewport(
      this.contextState[context],
      viewport,
      EDGE_MARGIN,
    );
  }

  private getViewportSize(): Size {
    if (typeof window === "undefined") {
      return { ...DEFAULT_WINDOW_SIZE };
    }

    return { width: window.innerWidth, height: window.innerHeight };
  }

  private persistState(): void {
    const state: PersistedState = {
      button: {
        anchor: this.contextState.button.anchor,
        anchorOffset: this.contextState.button.anchorOffset,
        hasCustomPosition: this.hasCustomPosition.button,
      },
      window: {
        anchor: this.contextState.window.anchor,
        anchorOffset: this.contextState.window.anchorOffset,
        size: {
          width: Math.round(this.contextState.window.size.width),
          height: Math.round(this.contextState.window.size.height),
        },
        hasCustomPosition: this.hasCustomPosition.window,
      },
      isOpen: this.isOpen,
      dockMode: this.dockMode,
      selectedMenu:
        this.pendingPersistedMenu ??
        (this.briefingRestoreMenu && this.selectedMenu === "home"
          ? this.briefingRestoreMenu
          : this.selectedMenu),
      selectedContext: this.selectedContext,
      hasOpenedInspector: this.hasOpenedInspector,
      sidebarCollapsed: this.sidebarCollapsed,
      colorSchemePreference: this.hasExplicitColorScheme
        ? this.colorScheme
        : undefined,
    };
    saveInspectorState(INSPECTOR_STORAGE_KEY, state);
    this.pendingSelectedContext = state.selectedContext ?? null;
  }

  private clampWindowSize(size: Size): Size {
    // Use smaller minimum width when docked left
    const minWidth =
      this.dockMode === "docked-left"
        ? MIN_WINDOW_WIDTH_DOCKED_LEFT
        : MIN_WINDOW_WIDTH;

    if (typeof window === "undefined") {
      return {
        width: Math.max(minWidth, size.width),
        height: Math.max(MIN_WINDOW_HEIGHT, size.height),
      };
    }

    const viewport = this.getViewportSize();
    return clampSizeToViewport(
      size,
      viewport,
      EDGE_MARGIN,
      minWidth,
      MIN_WINDOW_HEIGHT,
    );
  }

  private setDockMode(mode: DockMode): void {
    if (this.dockMode === mode) {
      return;
    }

    // Add transition class for smooth dock mode changes
    this.startHostTransition();

    // Clean up previous dock state
    this.removeDockStyles();

    this.dockMode = mode;

    if (mode !== "floating") {
      // For docking, set the target size immediately so body margins are correct
      if (mode === "docked-left") {
        this.contextState.window.size.width = DOCKED_LEFT_WIDTH;
      }

      // Then apply dock styles with correct sizes
      this.applyDockStyles();
    } else {
      // When floating, set size first then center
      this.contextState.window.size = this.clampWindowSize(DEFAULT_WINDOW_SIZE);
      this.centerContext("window");
    }

    this.persistState();
    this.requestUpdate();
    this.updateHostTransform("window");
  }

  private startHostTransition(duration = 300): void {
    this.setAttribute("data-transitioning", "true");

    if (this.transitionTimeoutId !== null) {
      clearTimeout(this.transitionTimeoutId);
    }

    this.transitionTimeoutId = setTimeout(() => {
      this.removeAttribute("data-transitioning");
      this.transitionTimeoutId = null;
    }, duration);
  }

  private applyDockStyles(skipTransition = false): void {
    if (typeof document === "undefined" || !document.body) {
      return;
    }

    // Save original body margins
    const computedStyle = window.getComputedStyle(document.body);
    this.previousBodyMargins = {
      left: computedStyle.marginLeft,
      bottom: computedStyle.marginBottom,
    };

    // Apply transition to body for smooth animation (only when docking, not during resize or initial load)
    if (!this.isResizing && !skipTransition) {
      document.body.style.transition = "margin 300ms ease";
    }

    // Apply body margins with the actual window sizes
    if (this.dockMode === "docked-left") {
      document.body.style.marginLeft = `${this.contextState.window.size.width}px`;
      if (this.previousHtmlOverflowX === null) {
        this.previousHtmlOverflowX = document.documentElement.style.overflowX;
      }
      document.documentElement.style.overflowX = "hidden";
    }

    // Remove transition after animation completes
    if (!this.isResizing && !skipTransition) {
      const id = setTimeout(() => {
        this.bodyTransitionTimeoutIds.delete(id);
        if (typeof document !== "undefined" && document.body) {
          document.body.style.transition = "";
        }
      }, 300);
      this.bodyTransitionTimeoutIds.add(id);
    }
  }

  private removeDockStyles(skipTransition = false): void {
    if (typeof document === "undefined" || !document.body) {
      return;
    }

    // Only add transition if not resizing and not skipping
    if (!this.isResizing && !skipTransition) {
      document.body.style.transition = "margin 300ms ease";
    }

    // Restore original margins if saved
    if (this.previousBodyMargins) {
      document.body.style.marginLeft = this.previousBodyMargins.left;
      document.body.style.marginBottom = this.previousBodyMargins.bottom;
      this.previousBodyMargins = null;
    } else {
      // Reset to default if no previous values
      document.body.style.marginLeft = "";
      document.body.style.marginBottom = "";
    }

    if (this.previousHtmlOverflowX !== null) {
      document.documentElement.style.overflowX = this.previousHtmlOverflowX;
      this.previousHtmlOverflowX = null;
    }

    // Clean up transition after animation completes
    if (!skipTransition) {
      const id = setTimeout(() => {
        this.bodyTransitionTimeoutIds.delete(id);
        if (typeof document !== "undefined" && document.body) {
          document.body.style.transition = "";
        }
      }, 300);
      this.bodyTransitionTimeoutIds.add(id);
    } else {
      document.body.style.transition = "";
    }
  }

  private updateHostTransform(context: ContextKey = this.activeContext): void {
    if (this.isPoppedOut) {
      return;
    }
    if (context !== this.activeContext) {
      return;
    }

    // For docked states, CSS handles positioning with fixed positioning
    if (this.isOpen && this.dockMode === "docked-left") {
      this.setAttribute("data-docked", "true");
      this.style.transform = "none";
    } else {
      this.removeAttribute("data-docked");
      const { position } = this.contextState[context];
      this.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
  }

  private setDragging(value: boolean): void {
    if (this.isDragging !== value) {
      this.isDragging = value;
      this.requestUpdate();
    }
  }

  private updateAnchorFromPosition(context: ContextKey): void {
    if (typeof window === "undefined") {
      return;
    }
    const viewport = this.getViewportSize();
    updateAnchorFromPositionHelper(
      this.contextState[context],
      viewport,
      EDGE_MARGIN,
    );
  }

  private snapButtonToCorner(): void {
    if (typeof window === "undefined") {
      return;
    }

    const viewport = this.getViewportSize();
    const state = this.contextState.button;

    // Determine which corner is closest based on center of button
    const centerX = state.position.x + state.size.width / 2;
    const centerY = state.position.y + state.size.height / 2;

    const horizontal: Anchor["horizontal"] =
      centerX < viewport.width / 2 ? "left" : "right";
    const vertical: Anchor["vertical"] =
      centerY < viewport.height / 2 ? "top" : "bottom";

    // Set anchor to nearest corner
    state.anchor = { horizontal, vertical };

    // Always use EDGE_MARGIN as offset (pinned to corner)
    state.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };

    // Apply the anchor position to snap to corner
    this.startHostTransition();
    this.applyAnchorPosition("button");
  }

  private applyAnchorPosition(context: ContextKey): void {
    if (this.isPoppedOut) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const viewport = this.getViewportSize();
    applyAnchorPositionHelper(
      this.contextState[context],
      viewport,
      EDGE_MARGIN,
    );
    this.updateHostTransform(context);
    this.persistState();
  }

  private resetResizeTracking(): void {
    this.resizePointerId = null;
    this.resizeStart = null;
    this.resizeInitialSize = null;
    this.resizeInitialPosition = null;
    this.resizeEdge = "se";
    this.isResizing = false;
  }

  private resetPointerTracking(): void {
    this.pointerId = null;
    this.dragStart = null;
    this.pointerContext = null;
    this.setDragging(false);
    this.draggedDuringInteraction = false;
  }

  public openInspector(
    source: InspectorOpenSource,
    options: InspectorOpenOptions = {},
  ): void {
    if (this.isInspectorDismissed) {
      return;
    }
    if (options.threadId) {
      this.focusThread(options);
    }

    if (this.isPoppedOut) {
      return;
    }
    if (this.isOpen) {
      return;
    }

    const hadUnseenAnnouncement = this.newsSignalArmed;
    // Captured from the pre-open state, exactly as the unread-announcement
    // property is: after `isOpen` flips there is no launcher, so the question
    // "was a signal on the launcher when this open happened" has no answer.
    const activeSignalAtOpen = this.getActiveLauncherSignal();
    const firstOpen = !this.hasOpenedInspector;
    this.hasOpenedInspector = true;
    this.homeViewedThisOpen = false;
    this.closeLauncherHud();

    // A press on the launcher is a gesture towards whatever the dot is about,
    // so it lands where that subject is explained. Restoring a persisted-open
    // panel is not a gesture and deliberately does not route through here.
    // A HUD row sets `hudLandingMenu` and wins, so a red dot cannot steal
    // "Turn on Threads".
    const hudMenu = this.hudLandingMenu;
    this.hudLandingMenu = null;
    if (hudMenu) {
      // Use the same activation path as sidebar navigation. In particular,
      // Learning must initialize its lazy memory subscription before deciding
      // whether to show the enabled view or the setup gate.
      this.handleMenuSelect(hudMenu);
    } else if (activeSignalAtOpen !== null && source === "floating_button") {
      const landing = LAUNCHER_SIGNALS[activeSignalAtOpen].landingTarget;
      this.selectedMenu = landing;
      this.lastSelectedMenuByGroup[getGroupForMenu(landing)] = landing;
      if (landing === "agents" || landing === "ag-ui-events") {
        if (isEventErrorKey(activeSignalAtOpen)) {
          this.applyEventErrorLanding(activeSignalAtOpen);
        }
      }
    }

    this.ensureAnnouncementLoading();

    this.isOpen = true;
    // The launcher is gone, so its gesture is gone with it — and the slot it
    // was holding is free again for whatever beats after the panel closes.
    this.cancelGestureTail();
    this.persistState(); // Save the open state

    this.trackOpened(
      source,
      hadUnseenAnnouncement,
      firstOpen,
      activeSignalAtOpen,
    );

    // Apply docking styles if in docked mode
    if (this.dockMode !== "floating") {
      this.applyDockStyles();
    }

    this.ensureWindowPlacement();
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.measureContext("window");
      if (this.dockMode === "floating") {
        if (this.hasCustomPosition.window) {
          this.applyAnchorPosition("window");
        } else {
          this.centerContext("window");
        }
      } else {
        // Update transform for docked position
        this.updateHostTransform("window");
      }
    });
  }

  private closeInspector(): void {
    if (this.isPoppedOut) {
      return;
    }
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;

    // Remove docking styles when closing
    if (this.dockMode !== "floating") {
      this.removeDockStyles();
    }

    this.persistState(); // Save the closed state
    this.updateHostTransform("button");
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.measureContext("button");
      this.applyAnchorPosition("button");
      // Flush point for defer reason 1: there is a launcher again — and only
      // now is it where it belongs. The anchor is applied after the render that
      // would mount the pill, so flushing any earlier makes the pill measure
      // the room around a launcher that has not moved into place yet, and a
      // stale measurement can suppress a pill that had room all along.
      this.flushPendingSignalPulse();
    });
  }

  private renderIcon(name: LucideIconName) {
    const iconNode = icons[name];
    if (!iconNode) {
      return nothing;
    }

    const svgAttrs: Record<string, string | number> = {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "h-3.5 w-3.5",
    };

    const svgMarkup = `<svg ${this.serializeAttributes(svgAttrs)}>${iconNode
      .map(([tag, attrs]) => `<${tag} ${this.serializeAttributes(attrs)} />`)
      .join("")}</svg>`;

    return unsafeHTML(svgMarkup);
  }

  private renderWindowLayoutMenu() {
    const dockAction =
      this.dockMode === "floating"
        ? {
            label: "Dock to left",
            icon: "PanelLeft" as LucideIconName,
            mode: "docked-left" as DockMode,
          }
        : {
            label: "Float window",
            icon: "Maximize2" as LucideIconName,
            mode: "floating" as DockMode,
          };

    return html`
      <div
        class="inspector-window-layout"
        data-inspector-window-layout-root="true"
      >
        <button
          class="inspector-account-control inspector-window-layout-trigger flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          type="button"
          aria-label="Window layout"
          aria-haspopup="menu"
          aria-expanded=${this.layoutMenuOpen}
          title="Window layout"
          style=${INTERACTIVE_FOCUS_BASE_STYLE}
          @click=${this.handleLayoutMenuToggle}
        >
          ${this.renderIcon("PanelsTopLeft")}
        </button>
        ${
          this.layoutMenuOpen
            ? html`
              <div
                class="inspector-window-layout-menu"
                role="menu"
                aria-label="Window layout"
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-label=${dockAction.label}
                  @click=${() => this.handleDockClick(dockAction.mode)}
                >
                  <span aria-hidden="true"
                    >${this.renderIcon(dockAction.icon)}</span
                  >
                  <span>${dockAction.label}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Detach Inspector into its own window"
                  data-testid="cpk-inspector-pop-out"
                  .click=${this.requestPopOut}
                  @click=${this.requestPopOut}
                >
                  <span aria-hidden="true"
                    >${this.renderIcon("PictureInPicture2")}</span
                  >
                  <span>Open in new window</span>
                </button>
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  private handleLayoutMenuToggle = (event: Event): void => {
    event.stopPropagation();
    this.contextMenuOpen = false;
    if (!this.layoutMenuOpen && this.dockMode === "floating") {
      this.contextState.window.size = this.getRenderedInspectorWindowSize();
    }
    this.layoutMenuOpen = !this.layoutMenuOpen;
    this.requestUpdate();
  };

  private getDockedWindowStyles(): Record<string, string> {
    if (this.dockMode === "docked-left") {
      return {
        position: "fixed",
        top: "0",
        left: "0",
        bottom: "0",
        width: `${Math.round(this.contextState.window.size.width)}px`,
        height: "auto",
        minWidth: `${MIN_WINDOW_WIDTH_DOCKED_LEFT}px`,
        borderRadius: "0",
      };
    }
    // Default to floating styles
    return {
      width: `${Math.round(this.contextState.window.size.width)}px`,
      height: `${Math.round(this.contextState.window.size.height)}px`,
      minWidth: `${MIN_WINDOW_WIDTH}px`,
      minHeight: `${MIN_WINDOW_HEIGHT}px`,
    };
  }

  private handleDockClick(mode: DockMode): void {
    this.layoutMenuOpen = false;
    this.setDockMode(mode);
  }

  private serializeAttributes(
    attributes: Record<string, string | number | undefined>,
  ): string {
    return Object.entries(attributes)
      .filter(
        ([key, value]) =>
          key !== "key" &&
          value !== undefined &&
          value !== null &&
          value !== "",
      )
      .map(
        ([key, value]) => `${key}="${String(value).replace(/"/g, "&quot;")}"`,
      )
      .join(" ");
  }

  private get contextOptions() {
    return this.live.contextOptions;
  }

  private set contextOptions(value: Array<{ key: string; label: string }>) {
    this.live.contextOptions = value;
  }

  private get selectedContext() {
    return this.live.selectedContext;
  }

  private set selectedContext(value: string) {
    this.live.selectedContext = value;
  }

  private get expandedRows() {
    return this.live.expandedEventIds;
  }

  private get expandedTools() {
    return this.live.expandedToolIds;
  }

  private get expandedContextItems() {
    return this.live.expandedContextIds;
  }

  private renderCoreWarningBanner() {
    if (this._core) {
      return nothing;
    }

    return html`
      <div
        class="mx-4 my-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        <span class="mt-0.5 shrink-0 text-amber-600"
          >${this.renderIcon("AlertTriangle")}</span
        >
        <div class="space-y-1">
          <div class="font-semibold text-amber-900">
            CopilotKit core not attached
          </div>
          <p class="text-[11px] leading-snug text-amber-800">
            Pass a live <code>CopilotKitCore</code> instance to
            <code>&lt;cpk-web-inspector&gt;</code> or expose it on
            <code>window.__COPILOTKIT_CORE__</code> for auto-attach.
          </p>
        </div>
      </div>
    `;
  }

  private getCoreStatusSummary(): CoreStatusSummary {
    if (!this._core) {
      return {
        label: "Core not attached",
        state: "unavailable",
        description:
          "Pass a CopilotKitCore instance to <cpk-web-inspector> or enable auto-attach.",
      };
    }

    const status =
      this.runtimeStatus ?? CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    const lastErrorMessage = this.lastCoreError?.message;

    if (status === CopilotKitCoreRuntimeConnectionStatus.Error) {
      return {
        label: "Runtime error",
        state: "error",
        description:
          lastErrorMessage ?? "CopilotKit runtime reported an error.",
      };
    }

    if (status === CopilotKitCoreRuntimeConnectionStatus.Connecting) {
      return {
        label: "Connecting",
        state: "connecting",
        description: "Waiting for CopilotKit runtime to finish connecting.",
      };
    }

    if (status === CopilotKitCoreRuntimeConnectionStatus.Connected) {
      return {
        label: "Connected",
        state: "connected",
        description: "Live runtime connection established.",
      };
    }

    return {
      label: "Disconnected",
      state: "disconnected",
      description:
        lastErrorMessage ?? "Waiting for CopilotKit runtime to connect.",
    };
  }

  private resolvePlaygroundAgentId(preferredAgentId?: string): string | null {
    return resolvePlaygroundAgentId(this._core?.agents ?? {}, preferredAgentId);
  }

  private teardownPlaygroundAgent(): void {
    const cleanup = clearPlaygroundSession(this.playground);
    cleanup.unsubscribe?.();
    if (cleanup.agent && cleanup.wasRunning) {
      cleanup.agent.abortRun();
      void cleanup.agent.detachActiveRun().catch(() => {});
    }
  }

  private syncPlaygroundMessages(): void {
    const agent = this.playground.agent;
    if (
      !agent ||
      !syncPlaygroundMessages(this.playground, agent, normalizeAgentMessages)
    ) {
      return;
    }
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const messages = this.activeRoot.querySelector<HTMLElement>(
        "[data-playground-messages]",
      );
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
  }

  private startPlaygroundSession(
    showEphemeralNotice: boolean,
    seedMessages: Message[] = [],
    seedState: unknown = {},
    preferredAgentId?: string,
  ): void {
    this.teardownPlaygroundAgent();
    const core = this._core;
    const session = createPlaygroundSession(this.playground, {
      agents: core?.agents ?? {},
      preferredAgentId: preferredAgentId ?? this.selectedContext,
      runtimeMode: core?.runtimeMode ?? "sse",
      showEphemeralNotice,
      seedMessages,
      seedState,
      createThreadId: createPlaygroundThreadId,
      getAgent: core
        ? (agentId) =>
            typeof core.getAgent === "function"
              ? core.getAgent(agentId)
              : core.agents[agentId]
        : undefined,
    });
    if (!session) {
      this.requestUpdate();
      return;
    }

    if (this.selectedContext !== session.agentId) {
      this.selectedContext = session.agentId;
    }
    const subscriber = createPlaygroundSubscriber(
      this.playground,
      session.agent,
      {
        syncMessages: () => this.syncPlaygroundMessages(),
        requestUpdate: () => this.requestUpdate(),
      },
    );
    const { unsubscribe } = session.agent.subscribe(subscriber);
    this.playground.agentUnsubscribe = unsubscribe;
    this.syncPlaygroundMessages();
  }

  private handlePlaygroundThreadSourceChange = async (
    event: Event,
  ): Promise<void> => {
    const source = event.currentTarget;
    if (!isPlaygroundSelectElement(source)) return;
    const threadId = source.value;
    if (!threadId) {
      this.startPlaygroundSession(false);
      return;
    }

    const core = this._core;
    const thread = this.threads.threads.find(
      (candidate) => candidate.id === threadId,
    );
    if (!core?.runtimeUrl || !thread) return;
    const loaded = await loadPlaygroundThread(this.playground, {
      thread,
      runtimeUrl: core.runtimeUrl,
      headers: core.headers,
      fetch,
      requestUpdate: () => this.requestUpdate(),
    });
    if (!loaded) return;
    this.startPlaygroundSession(
      false,
      mapPlaygroundMessagesToAgent(loaded.messages),
      loaded.threadState,
      loaded.agentId,
    );
    this.playground.sourceThreadId = loaded.threadId;
    this.requestUpdate();
  };

  private runPlaygroundAgent = async (): Promise<void> => {
    const core = this._core;
    if (!core) return;
    await runPlaygroundAgent(this.playground, {
      runAgent: (agent) => core.runAgent({ agent }),
      syncMessages: () => this.syncPlaygroundMessages(),
      requestUpdate: () => this.requestUpdate(),
    });
  };

  private getPlaygroundComposerController() {
    return {
      state: this.playground,
      selectedAgentId: this.resolvePlaygroundAgentId(this.selectedContext),
      createMessageId: createPlaygroundThreadId,
      startSession: (preferredAgentId?: string) =>
        this.startPlaygroundSession(false, [], {}, preferredAgentId),
      syncMessages: () => this.syncPlaygroundMessages(),
      runAgent: this.runPlaygroundAgent,
      requestUpdate: () => this.requestUpdate(),
    };
  }

  private sendPlaygroundMessage(content: string): void {
    sendPlaygroundMessage(this.getPlaygroundComposerController(), content);
  }

  private handlePlaygroundSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.sendPlaygroundMessage(this.playground.input.trim());
  };

  private handlePlaygroundSuggestion = (message: string): void => {
    this.sendPlaygroundMessage(message.trim());
  };

  private handlePlaygroundInput = (event: Event): void => {
    updatePlaygroundInput(this.playground, event, () => this.requestUpdate());
  };

  private handlePlaygroundKeyDown = (event: KeyboardEvent): void => {
    submitPlaygroundOnEnter(event);
  };

  private handlePlaygroundRetry = (): void => {
    retryPlaygroundRun(this.getPlaygroundComposerController());
  };

  private handlePlaygroundStop = (): void => {
    this.playground.agent?.abortRun();
  };

  private renderMainContent() {
    if (this.settingsOpen) {
      return this.renderSettingsPanel();
    }

    if (this.selectedMenu === "home") {
      return this.renderHomeView();
    }

    if (this.selectedMenu === WHATS_NEW_MENU_KEY) {
      return this.renderWhatsNewView();
    }

    if (this.selectedMenu === "ag-ui-events") {
      return html`
        <div class="flex h-full min-h-0 flex-col">
          ${this.renderEventErrorBanner("run")}
          <div class="min-h-0 flex-1 overflow-hidden">
            ${this.renderLiveEventsTable()}
          </div>
        </div>
      `;
    }

    if (this.selectedMenu === "playground") {
      return this.renderPlaygroundView();
    }

    if (this.selectedMenu === "agents") {
      return this.renderLiveAgentsView();
    }

    if (this.selectedMenu === "frontend-tools") {
      return this.renderLiveToolsView();
    }

    if (this.selectedMenu === "capabilities") {
      return this.renderLiveCapabilitiesView();
    }

    if (this.selectedMenu === "agent-context") {
      return this.renderLiveContextView();
    }

    if (this.selectedMenu === "threads") {
      return this.renderThreadsView();
    }

    if (this.selectedMenu === "memories") {
      return this.renderMemoriesView();
    }

    return nothing;
  }

  private renderPlaygroundView() {
    const agentId = this.resolvePlaygroundAgentId(this.selectedContext);
    return renderPlaygroundDomainView(
      {
        state: this.playground,
        agentId,
        sourceThreads: this.threads.threads,
        runtimeMode: this._core?.runtimeMode ?? "sse",
        runtimeLabel: this._core?.runtimeUrl ?? "Self-managed agent",
        suggestions:
          agentId && this._core
            ? this._core.getSuggestions(agentId).suggestions
            : [],
        intelligenceSignupUrl: this.getThreadsIntelligenceSignupUrl(),
        clipboard: this.getClipboard(),
        renderIcon: (name) => this.renderIcon(name),
        renderToolCalls: (toolCalls) => this.renderToolCallDetails(toolCalls),
      },
      {
        composer: {
          submit: this.handlePlaygroundSubmit,
          input: this.handlePlaygroundInput,
          keyDown: this.handlePlaygroundKeyDown,
          retry: this.handlePlaygroundRetry,
          stop: this.handlePlaygroundStop,
        },
        loadThread: this.handlePlaygroundThreadSourceChange,
        newThread: () => this.startPlaygroundSession(true),
        dismissEphemeralNotice: () => {
          this.playground.showEphemeralNotice = false;
          this.requestUpdate();
        },
        suggestion: this.handlePlaygroundSuggestion,
        retry: this.handlePlaygroundRetry,
      },
    );
  }

  private renderSettingsPanel() {
    const optedOut = this.core?.telemetryDisabled ?? false;
    const privateContent = [
      "Message content",
      "Agent state",
      "Prompts",
      "Completions",
    ];
    return html`
      <div
        class="inspector-settings"
        data-inspector-settings
        data-state=${optedOut ? "disabled" : "enabled"}
      >
        <header class="inspector-settings-header">
          <h1 class="inspector-settings-title">Settings</h1>
          <p class="inspector-settings-subtitle">
            Understand how the Inspector handles analytics and private content.
          </p>
        </header>

        <section
          class="inspector-settings-section"
          aria-labelledby="inspector-settings-privacy-title"
        >
          <div class="inspector-settings-section-heading">
            <span class="inspector-settings-section-icon" aria-hidden="true">
              ${this.renderIcon(optedOut ? "ShieldOff" : "ShieldCheck")}
            </span>
            <div>
              <h2 id="inspector-settings-privacy-title">Privacy</h2>
              <p>Analytics without access to your agent content.</p>
            </div>
          </div>

          <div
            class="inspector-settings-privacy"
            data-state=${optedOut ? "disabled" : "enabled"}
          >
            <div class="inspector-settings-status-row">
              <div>
                <h3>Anonymous usage analytics</h3>
                <p>
                  ${
                    optedOut
                      ? "Anonymous Inspector interaction data collection is disabled for this runtime."
                      : "CopilotKit collects anonymous Inspector interactions to understand which features people use."
                  }
                </p>
              </div>
              <span class="inspector-settings-status">
                ${optedOut ? "Analytics off" : "Analytics on"}
              </span>
            </div>

            <div class="inspector-settings-private-content">
              <strong>Content stays private</strong>
              <p>CopilotKit never collects:</p>
              <ul aria-label="Content CopilotKit never collects">
                ${privateContent.map(
                  (item) => html`
                    <li>
                      <span aria-hidden="true"
                        >${this.renderIcon("Check")}</span
                      >
                      ${item}
                    </li>
                  `,
                )}
              </ul>
            </div>

            <a
              class="inspector-settings-policy-link"
              href=${TELEMETRY_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Read the telemetry policy
              <span aria-hidden="true">${this.renderIcon("ArrowUpRight")}</span>
            </a>
          </div>
        </section>

        <section
          class="inspector-settings-section"
          aria-labelledby="inspector-settings-visibility-title"
        >
          <div class="inspector-settings-section-heading">
            <span class="inspector-settings-section-icon" aria-hidden="true">
              ${this.renderIcon("EyeOff")}
            </span>
            <div>
              <h2 id="inspector-settings-visibility-title">Visibility</h2>
              <p>Temporarily hide the Inspector on this domain.</p>
            </div>
          </div>

          <div class="inspector-settings-visibility">
            <div>
              <h3>Take a break from the Inspector</h3>
              <p>
                Hide the Inspector for seven days. It will return automatically
                when the week is over.
              </p>
            </div>
            <button
              type="button"
              class="inspector-settings-dismiss"
              data-cpk-dismiss-inspector="week"
              @click=${() => this.dismissInspectorFor("week")}
            >
              <span aria-hidden="true">${this.renderIcon("Clock")}</span>
              Hide Inspector for one week
            </button>
          </div>
        </section>
      </div>
    `;
  }

  // Fires `oss.inspector.opened` for a user-initiated open (OSS-566).
  // Restoring a persisted-open panel on mount assigns `isOpen` directly
  // instead of routing through `openInspector`, so page reloads and dev-server
  // hot reloads are not counted as opens.
  private trackOpened(
    source: InspectorOpenSource,
    hadUnseenAnnouncement: boolean,
    firstOpen = false,
    activeSignal: LauncherSignalKey | null = null,
  ): void {
    if (this.core?.telemetryDisabled) return;
    // Two properties rather than one, so an open can be attributed to a red
    // signal *and* to which failure class raised it. The failure message is
    // never included — `error_signal_source` is a closed two-value enum.
    const errorSignal =
      activeSignal !== null && isErrorSignalKey(activeSignal)
        ? activeSignal
        : null;
    // `license_status` and `runtime_mode` come from /info. Before the handshake
    // `licenseStatus` is undefined and `runtimeMode` reads its `sse` default, so
    // recording them would permanently attribute an early open against an
    // Intelligence runtime to SSE. Omitted rather than guessed — an absent
    // dimension is honest, a wrong one is not. `runtime_url_type` is derived
    // from configuration, so it is accurate immediately.
    const handshakeComplete = this.runtimeStatus === "connected";
    trackInspectorOpened({
      open_source: source,
      ...(handshakeComplete
        ? {
            license_status: this.core?.licenseStatus ?? undefined,
            runtime_mode: this.core?.runtimeMode ?? undefined,
          }
        : {}),
      runtime_url_type: getRuntimeUrlType(this.core?.runtimeUrl),
      has_unseen_announcement: hadUnseenAnnouncement,
      has_error_signal: errorSignal !== null,
      ...(errorSignal === null ? {} : { error_signal_source: errorSignal }),
      first_open: firstOpen,
    });
  }

  private getVisibleInspectorMetadataAction():
    | Readonly<{
        action: InspectorMetadataAction;
        placement: "threads-footer" | "locked";
      }>
    | undefined {
    const { threadsFooterAction, lockedAction } =
      this.inspectorMetadataProjection;
    if (
      threadsFooterAction &&
      !this.settingsOpen &&
      this.selectedMenu === "threads"
    ) {
      return { action: threadsFooterAction, placement: "threads-footer" };
    }
    if (
      lockedAction &&
      !this.settingsOpen &&
      this.selectedMenu === "threads" &&
      !this.areThreadEndpointsAvailable()
    ) {
      return { action: lockedAction, placement: "locked" };
    }
    return undefined;
  }

  /** Return paired stable navigation keys, or neither for an invalid leaf. */
  private getMetadataTelemetryNavigation(): Readonly<{
    group_key?: InspectorGroupKey;
    leaf_key?: MenuKey;
  }> {
    const selectedLeaf: unknown = this.selectedMenu;
    if (!isInspectorMenuKey(selectedLeaf)) return {};
    return {
      group_key: getGroupForMenu(selectedLeaf),
      leaf_key: selectedLeaf,
    };
  }

  /** Build metadata's shared coarse buckets and stable navigation context. */
  private getMetadataTelemetryContext(): Readonly<{
    usage_bucket: ThreadsUsageBucket;
    expiry_bucket: ThreadsExpiryBucket;
    group_key?: InspectorGroupKey;
    leaf_key?: MenuKey;
  }> {
    return {
      usage_bucket: this.getThreadsUsageBucket(),
      expiry_bucket: this.getThreadsExpiryBucket(),
      ...this.getMetadataTelemetryNavigation(),
    };
  }

  private trackMetadataModuleIfChanged(
    props: InspectorMetadataModuleViewedTelemetryProps,
    fingerprint: string,
  ): void {
    if (this.metadataTelemetryFingerprints.get(props.module) === fingerprint) {
      return;
    }
    this.metadataTelemetryFingerprints.set(props.module, fingerprint);
    try {
      trackMetadataModuleViewed(props);
    } catch {
      // Telemetry is best-effort and must never break Inspector rendering.
    }
  }

  private maybeTrackInspectorMetadataViews(): void {
    if (
      !this.isOpen ||
      this.runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected ||
      this.core?.telemetryDisabled
    ) {
      return;
    }

    const { identity, plan } = this.inspectorMetadataProjection;
    const license_bucket: InspectorMetadataLicenseBucket =
      this.inspectorMetadataProjection.licenseState;
    const telemetryContext = this.getMetadataTelemetryContext();
    const contextFingerprint = [
      telemetryContext.usage_bucket,
      telemetryContext.expiry_bucket,
      telemetryContext.group_key ?? null,
      telemetryContext.leaf_key ?? null,
    ];

    if (identity) {
      this.trackMetadataModuleIfChanged(
        { module: "identity", license_bucket, ...telemetryContext },
        JSON.stringify([
          license_bucket,
          ...contextFingerprint,
          identity.organizationName,
          identity.projectName,
        ]),
      );
    } else {
      this.metadataTelemetryFingerprints.delete("identity");
    }

    if (plan) {
      this.trackMetadataModuleIfChanged(
        { module: "plan", license_bucket, ...telemetryContext },
        JSON.stringify([
          license_bucket,
          ...contextFingerprint,
          plan.code,
          plan.label,
        ]),
      );
    } else {
      this.metadataTelemetryFingerprints.delete("plan");
    }

    const visibleAction = this.getVisibleInspectorMetadataAction();
    if (visibleAction) {
      const { action, placement } = visibleAction;
      const action_placement = getMetadataActionPlacement(placement);
      this.trackMetadataModuleIfChanged(
        {
          module: "action",
          action_kind: action.kind,
          license_bucket,
          ...telemetryContext,
          action_placement,
        },
        JSON.stringify([
          license_bucket,
          ...contextFingerprint,
          action_placement,
          action.kind,
          action.url,
        ]),
      );
    } else {
      this.metadataTelemetryFingerprints.delete("action");
    }
  }

  private handleInspectorMetadataActionClick = (
    action: InspectorMetadataAction,
    placement: "threads-footer" | "locked",
  ): void => {
    if (
      !this.isOpen ||
      this.runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected ||
      this.core?.telemetryDisabled
    ) {
      return;
    }
    if (action.kind === "enable_intelligence") {
      this.handleThreadsIntelligenceSignupClick();
      return;
    }
    try {
      trackMetadataActionClicked({
        action_kind: action.kind,
        license_bucket: this.inspectorMetadataProjection.licenseState,
        ...this.getMetadataTelemetryContext(),
        action_placement: getMetadataActionPlacement(placement),
      });
    } catch {
      // Telemetry is best-effort and must never break action navigation.
    }
  };

  private handleTalkToEngineerClick = (): void => {
    if (this.core?.telemetryDisabled) return;
    trackTalkToEngineerClicked(
      this.getThreadsCtaTelemetryProps("talk_to_engineer", "sidebar_footer"),
    );
  };

  private handleThreadsIntelligenceSignupClick = (): void => {
    if (this.core?.telemetryDisabled) return;
    trackThreadsIntelligenceSignupClicked(
      this.getThreadsCtaTelemetryProps("signup", "threads_locked"),
    );
  };

  private handleThreadsTalkToEngineerClick = (): void => {
    if (this.core?.telemetryDisabled) return;
    trackThreadsTalkToEngineerClicked(
      this.getThreadsCtaTelemetryProps("talk_to_engineer", "threads_locked"),
    );
  };

  private handleThreadDividerPointerDown = (event: PointerEvent) => {
    this.threads.threadDividerResizing = true;
    this.threads.threadDividerPointerId = event.pointerId;
    this.threads.threadDividerStartX = event.clientX;
    this.threads.threadDividerStartWidth = this.threads.threadListWidth;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private handleThreadDividerPointerMove = (event: PointerEvent) => {
    if (
      !this.threads.threadDividerResizing ||
      this.threads.threadDividerPointerId !== event.pointerId
    )
      return;
    const delta = event.clientX - this.threads.threadDividerStartX;
    this.threads.threadListWidth = Math.max(
      180,
      Math.min(480, this.threads.threadDividerStartWidth + delta),
    );
    this.requestUpdate();
  };

  private handleThreadDividerPointerUp = (event: PointerEvent) => {
    if (this.threads.threadDividerPointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this.threads.threadDividerPointerId)) {
      target.releasePointerCapture(this.threads.threadDividerPointerId);
    }
    this.threads.threadDividerResizing = false;
  };

  private trackThreadsViewStateOnce(
    state: "locked" | "empty_enabled" | "enabled",
  ): void {
    if (this.core?.telemetryDisabled) return;
    if (
      !claimThreadsViewState(this.threads, state, this.getThreadServiceStatus())
    ) {
      return;
    }
    const props = this.getThreadsTelemetryProps();
    if (state === "locked") {
      trackThreadsLockedViewed(props);
    } else if (state === "empty_enabled") {
      trackThreadsEmptyEnabledViewed(props);
    } else {
      trackThreadsEnabledViewed(props);
    }
  }

  private shouldRenderExampleThreads(
    locked: boolean,
    displayThreads: ɵThread[],
    threadsErrorMessage: string | null,
    threadsLoading: boolean,
  ): boolean {
    return shouldRenderExampleThreads(locked, {
      displayThreads,
      threadsErrorMessage,
      threadsLoading,
    });
  }

  private isExampleThreadId(threadId: string | null | undefined): boolean {
    return isExampleThreadId(threadId);
  }

  private getExampleThreadProvider(threadId: string): ThreadDebuggerProvider {
    return getExampleThreadProvider(this.threads, threadId);
  }

  private trackThreadsExampleViewedOnce(): void {
    if (this.core?.telemetryDisabled) return;
    for (const thread of THREADS_EXAMPLE_THREADS) {
      const exampleKind = getExampleKind(thread.id);
      if (!exampleKind || !claimExampleViewed(this.threads, exampleKind))
        continue;
      trackThreadsExampleViewed({
        ...this.getThreadsTelemetryProps(),
        example_kind: exampleKind,
      });
    }
  }

  private trackThreadsExampleSelectedOnce(threadId: string): void {
    if (this.core?.telemetryDisabled) return;
    const exampleKind = getExampleKind(threadId);
    if (!exampleKind || !claimExampleSelected(this.threads, exampleKind))
      return;
    trackThreadsExampleSelected({
      ...this.getThreadsTelemetryProps(),
      example_kind: exampleKind,
    });
  }

  private subscribeToInspectorThreadBridge(): void {
    subscribeThreadBridge(this.threads, () => this.requestUpdate());
  }

  private unsubscribeFromInspectorThreadBridge(): void {
    unsubscribeThreadBridge(this.threads);
  }

  private getViewInAppMode(
    thread: ɵThread | null,
    isExample: boolean,
  ): "hidden" | "view" | "stop" {
    return selectViewInAppMode(this.threads, thread, isExample);
  }

  private handleViewInApp = (): void => {
    const thread = this.getSelectedRealThread();
    if (!thread) return;
    viewThreadInApp(this.threads, thread);
    this.requestUpdate();
  };

  private handleStopViewing = (): void => {
    if (stopViewingThreadInApp(this.threads)) this.requestUpdate();
  };

  private getSelectedRealThread(): ɵThread | null {
    return selectRealThread(
      this.getActiveThreadsState().displayThreads,
      this.threads.selectedThreadId,
      this.threads.selectedLocalExampleThreadId,
    );
  }

  private getCurrentExampleTourProps():
    | (InspectorThreadTelemetryProps &
        Readonly<{
          example_kind: ExampleKind;
          tour_step: ExampleTourStep;
          tour_tab: ExampleTourTab;
        }>)
    | undefined {
    const exampleKind = this.threads.selectedThreadId
      ? getExampleKind(this.threads.selectedThreadId)
      : undefined;
    const tourPair = getExampleTourTelemetryPair(this.threads.exampleTourStep);
    if (!exampleKind || !tourPair) return undefined;
    return {
      ...this.getThreadsTelemetryProps(),
      example_kind: exampleKind,
      ...tourPair,
    };
  }

  private trackThreadsExampleTourStepViewedOnce(): void {
    if (this.core?.telemetryDisabled || !this.threads.selectedThreadId) return;
    const props = this.getCurrentExampleTourProps();
    if (!props) return;
    if (
      !claimExampleTourStep(this.threads, props.example_kind, props.tour_step)
    ) {
      return;
    }
    trackThreadsExampleTourStepViewed(props);
  }

  private syncExampleTourTab(): void {
    const step =
      THREADS_EXAMPLE_TOUR_STEPS[this.threads.exampleTourStep] ??
      THREADS_EXAMPLE_TOUR_STEPS[0]!;
    if (!step) return;
    void this.updateComplete.then(() => {
      const details = this.activeRoot.querySelector("cpk-thread-details") as
        | (ɵCpkThreadDetails & { selectTab?: (id: ThreadDetailsTab) => void })
        | null;
      details?.selectTab?.(step.tab);
    });
  }

  private startExampleTour(autoStarted: boolean): void {
    if (!activateExampleTour(this.threads, autoStarted)) return;
    if (autoStarted) {
      if (!this.core?.telemetryDisabled) {
        const props = this.getCurrentExampleTourProps();
        if (props) trackThreadsExampleTourStarted(props);
      }
    } else if (!this.core?.telemetryDisabled) {
      const props = this.getCurrentExampleTourProps();
      if (props) trackThreadsExampleTourReopened(props);
    }
    this.trackThreadsExampleTourStepViewedOnce();
    this.syncExampleTourTab();
    this.requestUpdate();
  }

  private setExampleTourStep(nextStep: number): void {
    const telemetryStepIsValid = updateExampleTourStep(this.threads, nextStep);
    if (telemetryStepIsValid) this.trackThreadsExampleTourStepViewedOnce();
    this.syncExampleTourTab();
    this.requestUpdate();
  }

  private dismissExampleTour(method: "skip" | "done"): void {
    if (!dismissTour(this.threads)) return;
    this.writeThreadsExampleTourDismissed();
    if (!this.core?.telemetryDisabled) {
      const currentProps = this.getCurrentExampleTourProps();
      if (currentProps) {
        const props = { ...currentProps, dismiss_method: method };
        if (method === "done") {
          trackThreadsExampleTourCompleted(props);
        } else {
          trackThreadsExampleTourDismissed(props);
        }
      }
    }
    this.requestUpdate();
  }

  private handleThreadsThreadSelected(
    threadId: string,
    showingExamples: boolean,
  ): void {
    const result = selectThread(this.threads, {
      threadId,
      showingExamples,
      isExample: this.isExampleThreadId(threadId),
      displayThreads: this.getActiveThreadsState().displayThreads,
    });
    if (result.kind === "example") {
      this.trackThreadsExampleSelectedOnce(threadId);
      if (result.autoStartTour) this.startExampleTour(true);
    }
    this.requestUpdate();
  }

  private readThreadsExampleTourDismissed(): boolean {
    return readExampleTourDismissed(
      typeof window === "undefined" ? null : window,
    );
  }

  private writeThreadsExampleTourDismissed(): void {
    writeExampleTourDismissed(typeof window === "undefined" ? null : window);
  }

  /** Tears down gates, listeners, playback, and source in cleanup order. */
  private cleanupThreadsExampleOverviewVideo(): void {
    cleanupThreadsExampleVideo({
      state: this.threads,
      win: typeof window === "undefined" ? null : window,
      isConnected: () => this.isConnected,
      requestUpdate: () => this.requestUpdate(),
    });
  }

  /** Reconciles the rendered media node with its current lifecycle. */
  private syncThreadsExampleOverviewVideo(): void {
    const video = this.activeRoot.querySelector<HTMLVideoElement>(
      ".cpk-threads-overview-video",
    );
    reconcileThreadsExampleVideo(
      {
        state: this.threads,
        win: typeof window === "undefined" ? null : window,
        isConnected: () => this.isConnected,
        requestUpdate: () => this.requestUpdate(),
      },
      video,
    );
  }

  /** Handles the external native Play/Pause control. */
  private handleThreadsExampleOverviewVideoControl = (): void => {
    controlThreadsExampleVideo({
      state: this.threads,
      win: typeof window === "undefined" ? null : window,
      isConnected: () => this.isConnected,
      requestUpdate: () => this.requestUpdate(),
    });
  };

  private renderThreadsExampleOverviewVideo() {
    return renderThreadsExampleVideo(
      this.threads,
      this.handleThreadsExampleOverviewVideoControl,
    );
  }

  private renderThreadsExampleOverview(locked: boolean) {
    const lockedCopy = locked ? this.getThreadsLockedCopy() : undefined;
    const { lockedAction } = this.inspectorMetadataProjection;
    return renderThreadsOverview({
      locked,
      lockedCopy,
      diagnostic: locked
        ? this.renderRuntimeEntitlementDiagnostic(
            this.getRuntimeEntitlementDiagnostic(),
          )
        : nothing,
      setupPrompt: locked
        ? this.renderFeatureSetupPrompt(
            "threads",
            "cpk-threads-overview-action cpk-threads-overview-action-primary",
          )
        : nothing,
      docsUrl: this.getThreadsDocsUrl(),
      onboardingAction: this.getThreadsEmptyOnboardingAction(),
      video: this.renderThreadsExampleOverviewVideo(),
      lockedAction: lockedAction
        ? this.renderInspectorAction(lockedAction, "locked")
        : nothing,
    });
  }

  private renderThreadsExampleTour() {
    return renderThreadsTour(this.threads, {
      start: () => this.startExampleTour(false),
      setStep: (step) => this.setExampleTourStep(step),
      dismiss: (method) => this.dismissExampleTour(method),
    });
  }

  private getThreadsLockedCopy(): {
    heading: string;
    description: string;
  } {
    switch (this.inspectorMetadataProjection.licenseState) {
      case "valid":
        return {
          heading: "Finish setting up Rich Threads",
          description:
            "Copy this prompt into your coding agent to finish the setup.",
        };
      case "none":
        return {
          heading: "Enable Intelligence to inspect Threads.",
          description:
            "Persist conversations and inspect saved thread history from the Inspector.",
        };
      case "expired":
        return {
          heading: "Renew Intelligence to inspect Threads.",
          description:
            "Your Intelligence access has expired. Renew it to inspect saved thread history.",
        };
      case "unknown":
        return {
          heading: "Threads are unavailable.",
          description:
            "This runtime does not expose Threads for the Inspector.",
        };
    }
  }

  /**
   * Prefer the Runtime's structured entitlement diagnostic and derive a
   * compatibility diagnostic only when an older Core exposes legacy status.
   */
  private getRuntimeEntitlementDiagnostic(): RuntimeEntitlementDisplayDiagnostic | null {
    const runtimeEntitlements = this.core?.runtimeEntitlements;
    if (runtimeEntitlements) {
      return runtimeEntitlements.status === "ready"
        ? { status: runtimeEntitlements.status }
        : {
            status: runtimeEntitlements.status,
            error: runtimeEntitlements.error,
          };
    }

    switch (this.core?.licenseStatus) {
      case "valid":
        return { status: "ready" };
      case "expired":
        return {
          status: "degraded",
          error: {
            code: "legacy_license_expired",
            message: "Legacy Runtime license has expired.",
            retryable: false,
          },
        };
      case "expiring":
        return {
          status: "degraded",
          error: {
            code: "legacy_license_expiring",
            message: "Legacy Runtime license is expiring.",
            retryable: false,
          },
        };
      case "invalid":
        return {
          status: "misconfigured",
          error: {
            code: "legacy_license_invalid",
            message: "Legacy Runtime license is invalid.",
            retryable: false,
          },
        };
      case "none":
      case "unknown":
        return { status: "unavailable" };
      default:
        return null;
    }
  }

  /** Render exact Runtime entitlement correlation details without gating UI. */
  private renderRuntimeEntitlementDiagnostic(
    diagnostic: RuntimeEntitlementDisplayDiagnostic | null,
  ) {
    if (!diagnostic) {
      return nothing;
    }

    return html`
      <div
        role="status"
        data-runtime-entitlement-status=${diagnostic.status}
        style="
          margin: -8px auto 18px;
          max-width: 380px;
          font-size: 11px;
          line-height: 1.5;
          color: #57575b;
        "
      >
        <div style="font-weight: 600;">
          Runtime entitlement: ${diagnostic.status}
        </div>
        ${
          diagnostic.error
            ? html`
              <div>${diagnostic.error.message}</div>
              <div>Code: ${diagnostic.error.code}</div>
              ${
                diagnostic.error.requestId
                  ? html`<div>Request ID: ${diagnostic.error.requestId}</div>`
                  : nothing
              }
              ${
                diagnostic.error.traceId
                  ? html`<div>Trace ID: ${diagnostic.error.traceId}</div>`
                  : nothing
              }
            `
            : nothing
        }
      </div>
    `;
  }

  /**
   * Renders the realtime-connection indicator in the memory-store header.
   * Only `"connected"` shows the live (green-dot) state; `"connecting"` shows a
   * muted amber "reconnecting" and `"unavailable"` a muted grey "offline", so
   * the indicator never claims "live" over a frozen snapshot once the realtime
   * socket has permanently given up.
   */
  private renderMemoriesView() {
    const learningEnabled = this.getHomeModel().services.some(
      (service) => service.id === "memory" && service.enabled,
    );
    return renderLearningView(
      {
        state: this.learning,
        enabled: learningEnabled,
        setupPrompt: this.renderFeatureSetupPrompt(
          "memory",
          "cpk-memory-locked-action",
        ),
        colorScheme: this.colorScheme,
        lockIcon: this.renderIcon("Lock"),
        talkToEngineerUrl: this.getTalkToEngineerUrl(),
        intelligenceSignupUrl: this.getIntelligenceSignupUrl(),
        loadErrorAdvice: EVENT_ERROR_GUIDANCE.memory.advice,
      },
      {
        talkToEngineer: this.handleThreadsTalkToEngineerClick,
        signUpForIntelligence: this.handleThreadsIntelligenceSignupClick,
        recallQueryChanged: (query) => setRecallQuery(this.learning, query),
        recallSubmitted: (query) => this.runRecall(query),
        recallCleared: () => this.clearRecall(),
      },
    );
  }

  /** Renders trusted Threads usage and its independent plan action. */
  private renderThreadsUsageFooter() {
    const { usage, threadsFooterAction } = this.inspectorMetadataProjection;
    const capacityState = this.getThreadsCapacityState();
    return renderThreadsDomainUsageFooter(
      usage,
      threadsFooterAction
        ? this.renderInspectorAction(
            threadsFooterAction,
            "threads-footer",
            capacityState === "warning" || capacityState === "critical"
              ? "Upgrade Your Plan"
              : threadsFooterAction.label,
          )
        : null,
      capacityState,
    );
  }

  private renderThreadsView() {
    const locked = !this.areThreadEndpointsAvailable();
    const { displayThreads, threadsErrorMessage, threadsLoading } =
      this.getActiveThreadsState();
    const loadingWithoutRows =
      !locked &&
      threadsLoading &&
      !threadsErrorMessage &&
      displayThreads.length === 0;

    const showingExamples = this.shouldRenderExampleThreads(
      locked,
      displayThreads,
      threadsErrorMessage,
      threadsLoading,
    );
    const visibleThreads =
      !locked && (threadsErrorMessage || loadingWithoutRows)
        ? []
        : showingExamples
          ? THREADS_EXAMPLE_THREADS
          : displayThreads;
    if (showingExamples) {
      this.trackThreadsExampleViewedOnce();
    }

    const selectedThread =
      this.threads.selectedThreadId != null
        ? (visibleThreads.find((t) => t.id === this.threads.selectedThreadId) ??
          null)
        : null;
    const selectedThreadIsLocalExample =
      selectedThread !== null &&
      selectedThread.id === this.threads.selectedLocalExampleThreadId;

    if (locked) {
      this.trackThreadsViewStateOnce("locked");
    } else if (
      !threadsErrorMessage &&
      (!threadsLoading || displayThreads.length > 0)
    ) {
      this.trackThreadsViewStateOnce(
        displayThreads.length === 0 ? "empty_enabled" : "enabled",
      );
    }

    const runtimeUrl = selectedThreadIsLocalExample
      ? ""
      : (this._core?.runtimeUrl ?? "");
    return renderThreadsDomainView(
      {
        state: this.threads,
        colorScheme: this.colorScheme,
        visibleThreads,
        displayThreadCount: displayThreads.length,
        selectedThread,
        selectedThreadIsLocalExample,
        threadsErrorMessage: locked ? null : threadsErrorMessage,
        loadingWithoutRows,
        showingExamples,
        runtimeUrl,
        headers: this._core?.headers ?? {},
        threadInspectionAvailable:
          selectedThreadIsLocalExample ||
          (this.areThreadEndpointsAvailable() &&
            this._core?.threadEndpoints?.inspect !== false),
        liveMessageVersion: selectedThread
          ? (this.liveMessageVersion.get(selectedThread.id) ?? 0)
          : 0,
        viewInAppMode: this.getViewInAppMode(
          selectedThread,
          selectedThreadIsLocalExample,
        ),
        provider:
          selectedThread && selectedThreadIsLocalExample
            ? this.getExampleThreadProvider(selectedThread.id)
            : null,
        agentStateInput: selectedThread
          ? this.getLatestStateForAgent(selectedThread.agentId)
          : undefined,
        agentEventsInput: selectedThread
          ? (this.agentEvents.get(selectedThread.agentId) ?? [])
          : [],
        agentMessagesInput: selectedThread
          ? selectedThreadIsLocalExample
            ? EMPTY_INSPECTOR_MESSAGES
            : this.getLiveAgentMessagesForThread(selectedThread)
          : EMPTY_INSPECTOR_MESSAGES,
        usageFooter: this.renderThreadsUsageFooter(),
        tour: this.renderThreadsExampleTour(),
        overview: this.renderThreadsExampleOverview(locked),
      },
      {
        selectThread: (threadId) =>
          this.handleThreadsThreadSelected(threadId, showingExamples),
        resizeStart: this.handleThreadDividerPointerDown,
        resizeMove: this.handleThreadDividerPointerMove,
        resizeEnd: this.handleThreadDividerPointerUp,
        viewInApp: this.handleViewInApp,
        stopViewing: this.handleStopViewing,
      },
    );
  }

  private renderLiveEventsTable(options: { embedded?: boolean } = {}) {
    const events = eventsForSelectedContext(this.live);
    const runError = this.eventErrorDetails.run;
    const failedRunEventId = runError
      ? this.findLatestRunErrorEvent(runError.agentId)?.id
      : undefined;
    return renderEventsView({
      state: this.live,
      events,
      embedded: options.embedded,
      failedRunEventId,
      clipboard: this.getClipboard(),
      renderIcon: (name) => this.renderIcon(name as LucideIconName),
      renderJson: renderJsonValue,
      onFilterInput: this.handleEventFilterInput,
      onAgentChange: this.handleEventAgentChange,
      onTypeChange: this.handleEventTypeChange,
      onResetFilters: () => this.resetEventFilters(),
      onExport: (filteredEvents) => this.exportEvents(filteredEvents),
      onClear: this.handleClearEvents,
      onToggle: (eventId, event) => this.toggleRowExpansion(eventId, event),
      onResizeStart: (event, column) =>
        this._onEvtColResizeStart(event, column),
      onResizeMove: (event) => this._onEvtColResizeMove(event),
      onResizeEnd: () => this._onEvtColResizeEnd(),
      onResizeKeyDown: (event, column) =>
        this.handleEventColumnResizeKeyDown(event, column),
    });
  }

  private handleEventFilterInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.eventFilterText = target?.value ?? "";
    this.requestUpdate();
  }

  private handleEventAgentChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const value = target?.value;
    if (!value) {
      return;
    }
    this.handleContextOptionSelect(value);
  }

  private handleEventTypeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const value = target?.value as InspectorAgentEventType | "all" | undefined;
    if (!value) {
      return;
    }
    this.eventTypeFilter = value;
    this.requestUpdate();
  }

  private resetEventFilters(): void {
    resetEventFilters(this.live);
    this.requestUpdate();
  }

  private _onEvtColResizeStart(e: PointerEvent, col: number): void {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this._evtColResize = {
      col,
      startX: e.clientX,
      startW: this.evtColWidths[col] ?? 0,
    };
  }

  private _onEvtColResizeMove(e: PointerEvent): void {
    if (!this._evtColResize) return;
    const { col, startX, startW } = this._evtColResize;
    resizeEventColumn(this.live, col, startW + (e.clientX - startX));
    this.requestUpdate();
  }

  private _onEvtColResizeEnd(): void {
    this._evtColResize = null;
  }

  private handleEventColumnResizeKeyDown(
    event: KeyboardEvent,
    column: number,
  ): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const step = event.shiftKey ? 1 : 10;
    resizeEventColumn(
      this.live,
      column,
      (this.live.eventColumnWidths[column] ?? 40) + direction * step,
    );
    this.requestUpdate();
  }

  private handleClearEvents = (): void => {
    clearEvents(this.live);
    this.requestUpdate();
  };

  private exportEvents(events: InspectorEvent[]): void {
    try {
      const payload = JSON.stringify(events, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `copilotkit-events-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export events", error);
    }
  }

  private renderLiveAgentsView() {
    const agentId =
      this.selectedContext === "all-agents" ? null : this.selectedContext;
    const stats = agentId
      ? agentStats(this.live, agentId)
      : {
          totalEvents: 0,
          lastActivity: null,
          messages: 0,
          toolCalls: 0,
          errors: 0,
        };
    const state = agentId ? latestStateForAgent(this.live, agentId) : null;
    return renderLiveAgentsView({
      agentId,
      status: agentId ? agentStatus(this.live, agentId) : "idle",
      stats,
      state,
      hasState: hasRenderableState(state),
      messages: agentId ? latestMessagesForAgent(this.live, agentId) : null,
      toolError: this.eventErrorDetails.tool,
      errorBanner: this.renderEventErrorBanner("tool"),
      toolsSection: agentId
        ? renderLiveAgentToolsSection({
            state: this.live,
            tools: toolsForAgent(this.live, agentId),
            available: this._core !== null,
            renderIcon: (name) => this.renderIcon(name as LucideIconName),
            onToggle: (id) => this.toggleToolExpansion(id),
          })
        : nothing,
      eventsSection: this.renderLiveEventsTable({ embedded: true }),
      clipboard: this.getClipboard(),
      renderIcon: (name) => this.renderIcon(name as LucideIconName),
      renderJson: renderJsonValue,
      onViewEvents: () => this.handleMenuSelect("ag-ui-events"),
    });
  }

  private renderLiveContextDropdown(iconRail = false) {
    return renderAgentScopeDropdown({
      state: this.live,
      agentsOnly: this.selectedMenu === "agents",
      iconRail,
      open: this.contextMenuOpen,
      renderIcon: (name) => this.renderIcon(name as LucideIconName),
      onToggle: this.handleContextDropdownToggle,
      onSelect: (key) => this.handleContextOptionSelect(key),
      onPointerEnter: this.handleIconRailContextPointerEnter,
      onPointerLeave: this.handleIconRailContextPointerLeave,
      onFocusIn: this.handleIconRailContextFocusIn,
      onFocusOut: this.handleIconRailContextFocusOut,
      onKeyDown: this.handleContextDropdownKeyDown,
    });
  }

  /**
   * The Agent view is empty on "All Agents". Pick the agent that just failed
   * a tool, or the one with the most recent activity.
   */
  private applyEventErrorLanding(key: InspectorEventErrorSource): void {
    const error = this.eventErrorDetails[key];
    if (!error) {
      if (this.selectedMenu === "agents") {
        this.focusAgentForView();
      }
      return;
    }

    if (
      error.agentId &&
      this.contextOptions.some((option) => option.key === error.agentId)
    ) {
      this.selectedContext = error.agentId;
    } else if (this.selectedMenu === "agents") {
      this.focusAgentForView(error);
    }

    if (key === "tool" && error.toolCallId) {
      this.pendingScrollToToolCallId = error.toolCallId;
      return;
    }

    if (key === "run") {
      this.eventFilterText = "";
      this.eventTypeFilter = "all";
      const event = this.findLatestRunErrorEvent(error.agentId);
      if (!event) return;
      this.expandedRows.clear();
      this.expandedRows.add(event.id);
      this.pendingScrollToEventId = event.id;
    }
  }

  /**
   * Whether the landing view really carries the item the card points at.
   * Mirrors the two branches of `applyEventErrorLanding` that can bail out.
   */
  private hasEventErrorHighlight(key: InspectorEventErrorSource): boolean {
    const error = this.eventErrorDetails[key];
    if (!error) return false;
    if (key === "tool") return error.toolCallId !== undefined;
    if (key === "run") {
      return this.findLatestRunErrorEvent(error.agentId) !== undefined;
    }
    return false;
  }

  private findLatestRunErrorEvent(
    agentId?: string,
  ): InspectorEvent | undefined {
    const events =
      agentId && agentId !== "all-agents"
        ? (this.agentEvents.get(agentId) ?? [])
        : this.flattenedEvents;
    return events.find((event) => event.type === "RUN_ERROR");
  }

  private flushErrorLandingScroll(): void {
    const eventId = this.pendingScrollToEventId;
    if (eventId) {
      this.pendingScrollToEventId = null;
      const row = Array.from(
        this.activeRoot.querySelectorAll<HTMLElement>(
          "[data-inspector-event-id]",
        ),
      ).find((candidate) => candidate.dataset.inspectorEventId === eventId);
      row?.scrollIntoView?.({ block: "center" });
    }

    const toolCallId = this.pendingScrollToToolCallId;
    if (toolCallId) {
      this.pendingScrollToToolCallId = null;
      const escaped = escapeSelectorValue(toolCallId);
      const card =
        this.activeRoot.querySelector<HTMLElement>(
          `[data-cpk-failed-tool-call="${escaped}"]`,
        ) ??
        this.activeRoot.querySelector<HTMLElement>(
          `[data-cpk-failed-tool-result="${escaped}"]`,
        );
      card?.scrollIntoView?.({ block: "center" });
    }
  }

  /**
   * The Agent view is empty on "All Agents". Pick the agent that just failed
   * a tool, or the one with the most recent activity.
   */
  private focusAgentForView(error?: InspectorEventErrorDetails): void {
    const agentOptions = this.contextOptions.filter(
      (opt) => opt.key !== "all-agents",
    );
    if (agentOptions.length === 0) return;

    const errorAgentId = error?.agentId;
    if (
      errorAgentId &&
      agentOptions.some((option) => option.key === errorAgentId)
    ) {
      this.selectedContext = errorAgentId;
      return;
    }

    if (this.selectedContext !== "all-agents") return;

    const mostRecent = agentOptions.reduce<{
      key: string;
      ts: number;
    } | null>((best, opt) => {
      const ts = this.getAgentStats(opt.key).lastActivity ?? -1;
      return best === null || ts > best.ts ? { key: opt.key, ts } : best;
    }, null);
    this.selectedContext = mostRecent ? mostRecent.key : agentOptions[0]!.key;
  }

  private handleMenuSelect(key: MenuKey): void {
    if (!this.menuItems.some((item) => item.key === key)) {
      return;
    }

    const previousMenu = this.selectedMenu;
    this.pendingPersistedMenu = null;
    this.briefingRestoreMenu = null;
    this.selectedMenu = key;
    this.settingsOpen = false;
    this.lastSelectedMenuByGroup[getGroupForMenu(key)] = key;

    // If leaving the agents view with multiple agents registered, restore
    // "all-agents" so the Events tab isn't silently filtered to one agent.
    if (previousMenu === "agents" && key !== "agents") {
      const agentCount = this.contextOptions.filter(
        (opt) => opt.key !== "all-agents",
      ).length;
      if (agentCount > 1) {
        this.selectedContext = "all-agents";
      }
    }

    // Deliberately NOT applying an event error's landing here. A landing is an
    // arrival, not a passing-through: it selects the failed agent, clears the
    // event filters and re-expands the failed row, which is help when the
    // reader came *because* of that error and vandalism when they did not.
    // Event-error details outlive being read on purpose, so the how-to-fix
    // card survives while it is being read — which means running this on every
    // visit resets the reader's own filters and agent scope for the rest of
    // the session, and silently undoes the `all-agents` restore eight lines
    // above. The three arrivals that *are* landings keep it: pressing the
    // launcher (`openInspector`), pressing the card (`refocusEventErrorLanding`)
    // and an error arriving while its view is already open (`armEventError`).

    if (key === "threads") {
      if (previousMenu !== "threads" && !this.core?.telemetryDisabled) {
        trackThreadsTabClicked(this.getThreadsTelemetryProps());
      }
      this.autoSelectLatestThread();
    }

    if (key === "playground" && !this.playground.agent) {
      this.startPlaygroundSession(false);
    }

    if (key === "memories") {
      // Lazily create + subscribe to the memory store on first activation. This
      // is the only place that touches getMemoryStore(), so the store/realtime
      // are never started just by attaching the inspector.
      this.ensureMemorySubscription();
      if (previousMenu !== "memories") {
        trackLearningTabClicked(this.learning, this.core?.telemetryDisabled);
      }
    }

    if (key === "home" && previousMenu !== "home") {
      this.homeViewedThisOpen = false;
    }

    if (key === "ag-ui-events" || key === "agents") {
      const keepErrorLanding =
        this.pendingScrollToEventId !== null ||
        this.pendingScrollToToolCallId !== null;
      if (!keepErrorLanding) {
        requestAnimationFrame(() => {
          const scroller = this.activeRoot.querySelector("#cpk-main-scroll");
          if (scroller) scroller.scrollTop = 0;
        });
      }
    }

    this.contextMenuOpen = false;
    this.layoutMenuOpen = false;
    this.persistState();
    this.requestUpdate();
  }

  private handleContextDropdownToggle(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.layoutMenuOpen = false;
    this.contextMenuOpen = !this.contextMenuOpen;
    this.requestUpdate();
  }

  private clearIconRailContextCloseTimer(): void {
    if (this.iconRailContextCloseTimer === null) {
      return;
    }
    clearTimeout(this.iconRailContextCloseTimer);
    this.iconRailContextCloseTimer = null;
  }

  /** Expand the icon-rail agent scope on hover while preserving keyboard access. */
  private handleIconRailContextPointerEnter = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      return;
    }
    this.clearIconRailContextCloseTimer();
    if (this.contextMenuOpen) {
      return;
    }
    this.layoutMenuOpen = false;
    this.contextMenuOpen = true;
    this.requestUpdate();
  };

  private handleIconRailContextPointerLeave = (): void => {
    if (!this.contextMenuOpen) {
      return;
    }
    this.clearIconRailContextCloseTimer();
    this.iconRailContextCloseTimer = setTimeout(() => {
      this.iconRailContextCloseTimer = null;
      this.contextMenuOpen = false;
      this.requestUpdate();
    }, 180);
  };

  private handleIconRailContextFocusIn = (): void => {
    this.clearIconRailContextCloseTimer();
  };

  private handleIconRailContextFocusOut = (event: FocusEvent): void => {
    const nextFocus = event.relatedTarget;
    if (
      nextFocus instanceof Node &&
      (event.currentTarget as HTMLElement).contains(nextFocus)
    ) {
      return;
    }
    this.handleIconRailContextPointerLeave();
  };

  private handleContextOptionSelect(key: string): void {
    if (!this.contextOptions.some((option) => option.key === key)) {
      return;
    }

    this.clearIconRailContextCloseTimer();
    if (this.selectedContext !== key) {
      this.selectedContext = key;
      this.expandedRows.clear();
      this.autoSelectLatestThread();
      if (this.selectedMenu === "playground") {
        this.startPlaygroundSession(false);
      }
    }

    this.contextMenuOpen = false;
    this.persistState();
    this.requestUpdate();
    void this.updateComplete.then(() => this.focusContextDropdownTrigger());
  }

  private handleContextDropdownKeyDown = (event: KeyboardEvent): void => {
    const targetId =
      event.target === null ? undefined : Reflect.get(event.target, "id");
    if (
      targetId === AGENT_SCOPE_TRIGGER_ID &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.clearIconRailContextCloseTimer();
      this.layoutMenuOpen = false;
      this.contextMenuOpen = true;
      this.requestUpdate();
      const position = event.key === "ArrowDown" ? "first" : "last";
      void this.updateComplete.then(() =>
        this.focusContextDropdownItem(position),
      );
      return;
    }

    if (event.key !== "Escape" || !this.contextMenuOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.clearIconRailContextCloseTimer();
    this.contextMenuOpen = false;
    this.requestUpdate();
    void this.updateComplete.then(() => this.focusContextDropdownTrigger());
  };

  private focusContextDropdownTrigger(): void {
    this.activeRoot
      .querySelector<HTMLButtonElement>(`#${AGENT_SCOPE_TRIGGER_ID}`)
      ?.focus();
  }

  private focusContextDropdownItem(position: "first" | "last"): void {
    const items = Array.from(
      this.activeRoot.querySelectorAll<HTMLButtonElement>(
        `#${AGENT_SCOPE_POPUP_ID} [role="menuitemradio"]`,
      ),
    );
    const index = position === "first" ? 0 : items.length - 1;
    items.forEach((item, itemIndex) => {
      item.tabIndex = itemIndex === index ? 0 : -1;
    });
    items[index]?.focus();
  }

  private renderLiveCapabilitiesView() {
    const core = this._core;
    const tools = core ? buildCapabilityRows(core) : [];
    const catalog = core
      ? (core.catalogComponents ?? []).map((component) => ({
          key: component.name,
          name: component.name,
          description: component.description,
          enabled: core.isCatalogComponentEnabled(component.name),
        }))
      : [];
    return renderLiveCapabilitiesView({
      available: core !== null,
      tools,
      catalog,
      renderIcon: (name) => this.renderIcon(name as LucideIconName),
      onToggleTool: (row) => this.handleToggleTool(row),
      onToggleCatalog: (row) => this.handleToggleCatalogComponent(row.name),
    });
  }

  private handleToggleTool(row: CapabilityToolRow): void {
    if (!this._core) return;
    const next = !row.enabled;
    // A1 contract: setToolEnabled(name, enabled, agentId?). Pass agentId only
    // when the tool is agent-scoped so global tools toggle globally.
    this._core.setToolEnabled(row.name, next, row.agentId);
    this._capabilitiesVersion += 1;
    this.requestUpdate();
  }

  private handleToggleCatalogComponent(name: string): void {
    if (!this._core) return;
    const next = !this._core.isCatalogComponentEnabled(name);
    this._core.setCatalogComponentEnabled(name, next);
    this._capabilitiesVersion += 1;
    this.requestUpdate();
  }

  private renderLiveToolsView() {
    this.refreshToolsSnapshot();
    const tools =
      this.selectedContext === "all-agents"
        ? this.cachedTools
        : this.cachedTools.filter(
            (tool) => !tool.agentId || tool.agentId === this.selectedContext,
          );
    return renderLiveToolsView({
      state: this.live,
      tools,
      available: this._core !== null,
      renderIcon: (name) => this.renderIcon(name as LucideIconName),
      onToggle: (id) => this.toggleToolExpansion(id),
    });
  }

  private toggleToolExpansion(toolId: string): void {
    if (this.expandedTools.has(toolId)) {
      this.expandedTools.delete(toolId);
    } else {
      this.expandedTools.add(toolId);
    }
    this.requestUpdate();
  }

  private renderLiveContextView() {
    return renderLiveContextView({
      state: this.live,
      clipboard: this.getClipboard(),
      renderIcon: (name) => this.renderIcon(name as LucideIconName),
      renderJson: renderJsonValue,
      onToggle: (id) => this.toggleContextExpansion(id),
    });
  }

  private toggleContextExpansion(contextId: string): void {
    if (this.expandedContextItems.has(contextId)) {
      this.expandedContextItems.delete(contextId);
    } else {
      this.expandedContextItems.add(contextId);
    }
    this.requestUpdate();
  }

  private handleGlobalPointerDown = (event: PointerEvent): void => {
    if (!this.contextMenuOpen && !this.layoutMenuOpen) {
      return;
    }

    const path = event.composedPath();
    const clickedDropdown = path.some((node) => {
      const candidate = node as {
        getAttribute?: (name: string) => string | null;
      };
      return (
        typeof candidate.getAttribute === "function" &&
        candidate.getAttribute("data-context-dropdown-root") === "true"
      );
    });
    const clickedLayoutMenu = path.some((node) => {
      const candidate = node as {
        getAttribute?: (name: string) => string | null;
      };
      return (
        typeof candidate.getAttribute === "function" &&
        candidate.getAttribute("data-inspector-window-layout-root") === "true"
      );
    });

    let changed = false;
    if (this.contextMenuOpen && !clickedDropdown) {
      this.contextMenuOpen = false;
      changed = true;
    }
    if (this.layoutMenuOpen && !clickedLayoutMenu) {
      this.layoutMenuOpen = false;
      changed = true;
    }
    if (changed) {
      this.requestUpdate();
    }
  };

  private toggleRowExpansion(eventId: string, event?: Event): void {
    // Don't toggle if user is selecting text
    const target = event?.currentTarget;
    const ownerDocument =
      target && "ownerDocument" in target
        ? (target as Node).ownerDocument
        : this.ownerDocument;
    const selection = ownerDocument?.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    if (this.expandedRows.has(eventId)) {
      this.expandedRows.delete(eventId);
    } else {
      this.expandedRows.add(eventId);
    }
    this.requestUpdate();
  }

  // ── Launcher signals ────────────────────────────────────────────────────

  /** Whether a given subject currently has something to say. */
  private isSignalArmed(key: LauncherSignalKey): boolean {
    if (isWiringErrorKey(key)) return this.errorSignalArmed[key];
    if (isEventErrorKey(key)) return this.eventErrorArmed[key];
    return this.newsSignalArmed;
  }

  /**
   * The signal that owns the single launcher dot, or null when the launcher is
   * quiet. Precedence rather than replacement: a suppressed signal stays armed
   * and takes the dot as soon as the higher-priority one clears, and its own
   * navigation marker is visible the whole time.
   */
  private getActiveLauncherSignal(): LauncherSignalKey | null {
    for (const key of LAUNCHER_SIGNAL_PRIORITY_ORDER) {
      if (this.isSignalArmed(key)) return key;
    }
    return null;
  }

  /**
   * The marker a navigation entry carries, or null for an unmarked entry.
   *
   * Markers are independent of the launcher's single dot, so a suppressed
   * signal is never actually hidden once the panel is open. They also render
   * on the entry that is *currently selected*: for the news signal that never
   * mattered, because its marker clears as soon as the view renders, but a
   * state mirror stays true while it is being read and suppressing it on the
   * active entry would make it reappear on navigating away.
   */
  private getNavigationSignalFor(
    key: MenuKey,
  ): LauncherSignalDefinition | null {
    for (const signalKey of LAUNCHER_SIGNAL_PRIORITY_ORDER) {
      const signal = LAUNCHER_SIGNALS[signalKey];
      if (signal.markerTarget !== key) continue;
      if (!this.isSignalArmed(signalKey)) continue;
      // The announcement's marker waits for the feed, so a still-loading feed
      // cannot mark an entry that has nothing to show yet.
      if (signalKey === NEWS_SIGNAL_ID && !this.announcementLoaded) continue;
      return signal;
    }
    return null;
  }

  /** Whether a wiring error source is currently red. */
  private hasArmedErrorSignal(): boolean {
    return WIRING_ERROR_KEYS.some((source) => this.errorSignalArmed[source]);
  }

  private armEventErrorFromCode(
    code: CopilotKitCoreErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const key = eventErrorKeyForCode(code);
    if (key === null) return;
    const agentId =
      typeof context?.agentId === "string" && context.agentId.length > 0
        ? context.agentId
        : undefined;
    const toolName =
      typeof context?.toolName === "string" && context.toolName.length > 0
        ? context.toolName
        : undefined;
    const toolCallId =
      typeof context?.toolCallId === "string" && context.toolCallId.length > 0
        ? context.toolCallId
        : undefined;
    this.armEventError(key, message, { agentId, toolName, toolCallId });
  }

  private armEventError(
    key: InspectorEventErrorSource,
    message: string,
    extras: {
      agentId?: string;
      toolName?: string;
      toolCallId?: string;
    } = {},
  ): void {
    this.eventErrorDetails[key] = { message, ...extras };
    const wasArmed = this.eventErrorArmed[key];
    this.eventErrorArmed[key] = true;
    if (!wasArmed) {
      this.startSignalPulse(key);
    }
    if (
      this.isOpen &&
      !this.settingsOpen &&
      this.selectedMenu === LAUNCHER_SIGNALS[key].landingTarget
    ) {
      this.applyEventErrorLanding(key);
    }
    this.requestUpdate();
  }

  private clearEventError(key: InspectorEventErrorSource): void {
    if (!this.eventErrorArmed[key]) return;
    this.eventErrorArmed[key] = false;
    this.errorSignalViewedSources.delete(key);
    this.retireSignal(key);
    this.requestUpdate();
  }

  private clearAllEventErrors(): void {
    for (const key of EVENT_ERROR_KEYS) {
      this.eventErrorDetails[key] = null;
      if (!this.eventErrorArmed[key]) continue;
      this.eventErrorArmed[key] = false;
      this.retireSignal(key);
    }
  }

  /**
   * An event error is unread until its landing view is actually on screen.
   * Opening the Inspector for a different leaf must not burn it.
   */
  private maybeCompleteEventErrorView(): void {
    if (!this.isOpen || this.settingsOpen) return;
    for (const key of EVENT_ERROR_KEYS) {
      if (!this.eventErrorArmed[key]) continue;
      if (this.selectedMenu !== LAUNCHER_SIGNALS[key].landingTarget) continue;
      this.clearEventError(key);
    }
  }

  private isReducedMotionPreferred(): boolean {
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    );
  }

  // ── What's new launcher signal ──────────────────────────────────────────

  private armNewsSignal(options: { pulse: boolean }): void {
    const wasArmed = this.newsSignalArmed;
    this.newsSignalArmed = true;
    if (options.pulse) {
      this.startSignalPulse(NEWS_SIGNAL_ID);
    } else if (!wasArmed) {
      this.requestUpdate();
    }
  }

  private clearNewsSignal(): void {
    if (!this.newsSignalArmed) return;
    this.newsSignalArmed = false;
    if (this.announcement) {
      saveAnnouncementReadTimestamp(this.announcement.timestamp);
    }
    this.retireSignal(NEWS_SIGNAL_ID);
    this.requestUpdate();
  }

  // ── The beat ────────────────────────────────────────────────────────────

  /**
   * Requests one beat for a signal, running it now or deferring it.
   *
   * There is a single pending slot and five reasons a beat cannot land. All
   * five are the same situation — "cannot land now, run later" — and treating
   * them alike is the point: three separate behaviours for one situation would
   * not survive a third signal.
   *
   * Reason 4 is not cosmetic. Starting a beat while one runs does not restart
   * the animation, because the attribute it binds to does not change value and
   * the pseudo-element selectors match on attribute *presence*; the running
   * beat would merely change colour mid-flight. A failure that arms during an
   * announcement beat must wait for that beat to end, or it would run only as
   * its final fraction.
   *
   * A failure's beat is followed by a pill, and the whole 3.4-second gesture
   * holds this one slot for its full duration. That is not a second scheduling
   * concept: reason 4 already says "another beat is running", and a gesture is
   * simply a longer beat.
   */
  private startSignalPulse(key: LauncherSignalKey): void {
    const deferred =
      // 1. The panel is open, so there is no visible launcher. Pop-out is the
      //    same case: the host page renders only a portal anchor.
      this.isOpen ||
      // 2. The developer deliberately hid the entire Inspector for a while.
      this.isInspectorDismissed ||
      // 3. Nobody is looking.
      (typeof document !== "undefined" &&
        document.visibilityState !== "visible") ||
      // 4. Another beat — or the pill that follows it — is already running.
      (this.gestureSlotSignal !== null && this.gestureSlotSignal !== key) ||
      // 5. Another signal currently owns the dot.
      this.getActiveLauncherSignal() !== key;

    if (deferred) {
      // One slot, and the more urgent beat keeps it. A lower-priority beat must
      // not evict a nudge about something worse — and it would fail the
      // re-check on the way out anyway, because it is not the active signal.
      // The evicted beat is not lost for good: its once-per-subject token is
      // still unspent, so it is offered again the next time it arms.
      const pending = this.pendingPulseSignal;
      if (
        pending === null ||
        LAUNCHER_SIGNALS[key].priority >= LAUNCHER_SIGNALS[pending].priority
      ) {
        this.pendingPulseSignal = key;
      }
      this.requestUpdate();
      return;
    }

    this.stopSignalPulse();
    this.pendingPulseSignal = null;
    this.pulsingSignal = key;
    // The once-per-subject token is written HERE, where the beat actually
    // runs — never when a signal arms. Spending it on arming would burn a
    // deferred beat unfired.
    if (isWiringErrorKey(key)) {
      this.errorBeatSpent = true;
    } else if (this.announcement && key === NEWS_SIGNAL_ID) {
      saveAnnouncementPulsedTimestamp(this.announcement.timestamp);
    }
    this.beginGestureTail(key);
    this.requestUpdate();
    if (typeof window === "undefined") return;
    this.pulseTimeoutId = setTimeout(() => {
      this.pulseTimeoutId = null;
      this.pulsingSignal = null;
      this.requestUpdate();
      // The beat says *here*; now the pill says *this*.
      if (this.gestureSignal === key && this.pillPhase === "closed") {
        this.openPill();
        return;
      }
      // Nothing follows the beat: either this signal opens no pill, or there
      // was no room for one, so the gesture ends with it.
      if (this.gestureSignal === key) {
        this.endGesture();
        return;
      }
      // Reason 4 has just cleared.
      this.flushPendingSignalPulse();
    }, LAUNCHER_SIGNALS[key].cadence);
  }

  private stopSignalPulse(): void {
    if (this.pulseTimeoutId !== null) {
      clearTimeout(this.pulseTimeoutId);
      this.pulseTimeoutId = null;
    }
    this.pulsingSignal = null;
  }

  /**
   * Runs a deferred beat if it can land now, and drops it if its reason to
   * exist has gone: a nudge about a problem that no longer exists is worse
   * than no nudge at all.
   */
  private flushPendingSignalPulse(): void {
    const key = this.pendingPulseSignal;
    if (key === null) return;
    if (!this.isSignalArmed(key)) {
      this.pendingPulseSignal = null;
      this.requestUpdate();
      return;
    }
    this.startSignalPulse(key);
  }

  /**
   * Drops a signal's gesture, pending or running, when the signal goes quiet.
   *
   * The pill closes early: it states a condition, and the condition has
   * stopped being true. The beat is left to finish, because a beat asserts
   * nothing — it says *here*, and "here" is still true.
   */
  private retireSignal(key: LauncherSignalKey): void {
    if (this.pendingPulseSignal === key) this.pendingPulseSignal = null;
    if (this.gestureSignal === key) this.closePillEarly();
    // A suppressed signal may now own the dot.
    this.flushPendingSignalPulse();
  }

  // ── The pill ────────────────────────────────────────────────────────────

  /**
   * The signal holding the single gesture slot: a beat in flight, or the pill
   * and spoken sentence that follow it. One slot, not two — see reason 4 in
   * `startSignalPulse`.
   */
  private get gestureSlotSignal(): LauncherSignalKey | null {
    return this.pulsingSignal ?? this.gestureSignal;
  }

  /**
   * Opens the gesture's tail alongside the beat, for a signal that carries a
   * pill. The pill is rendered immediately — clipped to nothing, so it shows
   * nothing — because its full width has to be on the page before the room
   * either side of the launcher can be measured.
   *
   * A signal with no pill label gets no tail at all, so the announcement's
   * gesture is exactly the beat it has always been.
   */
  private beginGestureTail(key: LauncherSignalKey): void {
    this.cancelPillTimeout();
    if (LAUNCHER_SIGNALS[key].pillLabel === undefined) {
      this.gestureSignal = null;
      this.pillPhase = null;
      this.pillDirection = null;
      return;
    }
    this.gestureSignal = key;
    this.pillPhase = "closed";
    this.pillDirection = null;
    this.closeLauncherHud();
  }

  /**
   * Chooses the side, or suppresses the pill, from the room actually available
   * at gesture start. Measured once, from the DOM, because the launcher is
   * draggable and its position persists: a reader who parked it near the left
   * edge would otherwise get a permanently truncated pill.
   *
   * Where neither side has room there is no pill at all rather than a cut-off
   * one — the dot and the beat still fire, so the signal is intact and only
   * the label is lost. Constraining where the reader may drag the control to
   * protect this animation was considered and rejected: the page is theirs.
   */
  private resolvePillDirection(): void {
    if (this.pillDirection !== null || this.pillPhase === null) return;
    const wrapper = this.activeRoot.querySelector<HTMLElement>(
      ".console-button-wrapper",
    );
    const button = wrapper?.querySelector<HTMLElement>(".console-button");
    const pill = wrapper?.querySelector<HTMLElement>(".cpk-launcher-pill");
    if (!button || !pill || typeof window === "undefined") return;

    const mark = button.getBoundingClientRect();
    // A clip changes what is painted, never the layout box, so this is the
    // pill's full width whichever phase it is in.
    const overhang = Math.max(
      0,
      pill.getBoundingClientRect().width - mark.width,
    );
    const viewportWidth = window.innerWidth;

    if (overhang === 0) {
      // Nothing extends past the mark, so there is nothing to fit.
      this.setPillOutcome("left");
      return;
    }
    if (mark.left - overhang >= EDGE_MARGIN) {
      // Leftwards is the natural direction: away from the launcher's own edge.
      this.setPillOutcome("left");
      return;
    }
    if (mark.right + overhang <= viewportWidth - EDGE_MARGIN) {
      this.setPillOutcome("right");
      return;
    }
    this.setPillOutcome(null);
  }

  /** Records the measurement's verdict, and drops the pill when it is null. */
  private setPillOutcome(direction: LauncherPillDirection | null): void {
    if (direction === null) {
      this.pillPhase = null;
      this.pillDirection = null;
      this.pillOutcome = "suppressed";
      this.requestUpdate();
      return;
    }
    this.pillDirection = direction;
    this.pillOutcome = "shown";
    this.requestUpdate();
  }

  /** Runs the pill's three phases in series once the beat has finished. */
  private openPill(): void {
    // Normally already measured during the beat; measured here too so the
    // gesture cannot depend on a render having happened in between.
    this.resolvePillDirection();
    if (this.pillPhase === null) {
      // The measurement found no room after all.
      this.endGesture();
      return;
    }
    this.advancePill("opening", ERROR_GESTURE_MS.open, () => {
      this.advancePill("holding", ERROR_GESTURE_MS.hold, () => {
        this.advancePill("closing", ERROR_GESTURE_MS.close, () => {
          this.endGesture();
        });
      });
    });
  }

  private advancePill(
    phase: LauncherPillPhase,
    duration: number,
    next: () => void,
  ): void {
    this.cancelPillTimeout();
    this.pillPhase = phase;
    this.requestUpdate();
    if (typeof window === "undefined") return;
    this.pillTimeoutId = setTimeout(() => {
      this.pillTimeoutId = null;
      next();
    }, duration);
  }

  /**
   * Closes the pill before its hold is out, because the failure it names has
   * been fixed. A pill that has not opened yet is simply dropped; the beat is
   * never cut short.
   */
  private closePillEarly(): void {
    // No pill in this gesture — there was no room for one — so the tail is
    // only the spoken sentence, and it ends here.
    if (this.pillPhase === null) {
      this.endGesture();
      return;
    }
    // Already on its way out.
    if (this.pillPhase === "closing") return;
    // Still inside the beat, so nothing has been asserted on screen yet: the
    // pill is dropped rather than closed, and the beat runs on to its end.
    if (this.pillPhase === "closed") {
      this.pillPhase = null;
      this.requestUpdate();
      return;
    }
    this.advancePill("closing", ERROR_GESTURE_MS.close, () => {
      this.endGesture();
    });
  }

  /** Releases the slot and leaves the plain mark with its dot behind. */
  private endGesture(): void {
    this.cancelGestureTail();
    this.requestUpdate();
    this.flushPendingSignalPulse();
  }

  /**
   * Drops the gesture's tail outright, with no closing animation, for the
   * cases where the launcher itself has gone: the panel opened over it, or the
   * element was removed from the page.
   */
  private cancelGestureTail(): void {
    this.cancelPillTimeout();
    this.gestureSignal = null;
    this.pillPhase = null;
    this.pillDirection = null;
  }

  private cancelPillTimeout(): void {
    if (this.pillTimeoutId !== null) {
      clearTimeout(this.pillTimeoutId);
      this.pillTimeoutId = null;
    }
  }

  // ── Error signal ────────────────────────────────────────────────────────

  /**
   * Whether each error source is currently broken.
   *
   * Only two *wiring* conditions qualify. App errors (runs, tools, memory)
   * are unread events on a different latch — they name themselves on the pill
   * and clear when their landing view is read. Notably absent from *this*
   * latch:
   *
   * - **A failed agent run.** A run is an event. It arms `run`, not this
   *   state. The resting wiring dot must not stay red for the rest of a debug
   *   hour.
   * - **The core error channel as a wiring source.** Handshake failure already
   *   sets the connection state. Other codes arm `run` or `tool`.
   * - **Memory failures before Learning is live.** The memory store is lazy
   *   because creating it opens a realtime connection. Once it exists, a load
   *   failure arms `memory`.
   * - **Product states.** An unconfigured Intelligence and an unentitled
   *   Memory plan are not defects. The signal fires only where wiring is
   *   present and the call still fails — which for threads is guaranteed by
   *   `_threadsErrorByAgent` only ever being written while the thread
   *   endpoints are available.
   *
   * Known limitation: the runtime handshake runs once, on connect. A server
   * that dies *after* the page loaded leaves the connection state at connected
   * and raises nothing; the next page load re-runs the handshake and the
   * signal appears then. The signal reports the wiring state as last
   * established. Closing that gap means a re-probe in the core, which is a
   * runtime concern.
   */
  private isErrorSourceBroken(source: InspectorWiringErrorSource): boolean {
    if (source === "connection") {
      const state = this.getCoreStatusSummary().state;
      // The same derivation System Health reads, so the launcher dot is red
      // exactly when System Health says the runtime needs attention.
      if (runtimeConnectionNeedsAttention(state)) return true;
      // A reconnect is not a heal. Stay red through `connecting` so the
      // cards do not flash off between retries.
      return this.errorSignalArmed.connection && state === "connecting";
    }
    return this.threads.threadsErrorByAgent.size > 0;
  }

  /**
   * Mirrors both error latches onto the live state. Called from `willUpdate`,
   * because every mutation of the underlying state already requests an update,
   * so the resting dot follows the state within the same render.
   */
  private evaluateErrorSignals(): void {
    const wasArmed = this.hasArmedErrorSignal();

    for (const source of WIRING_ERROR_KEYS) {
      const broken = this.isErrorSourceBroken(source);
      if (broken) {
        if (this.errorSignalArmed[source]) continue;
        // Arming is immediate, with no window a short failure has to outlive
        // first. That is a decision, not an omission, so here is what it costs
        // and what would change it.
        //
        // `threads` can genuinely flap: the list is refetched on events, at up
        // to one request per debounce interval, so a failure followed
        // by a success plays a whole gesture for a blip that is already over.
        // The damage is bounded by machinery that is already here — one
        // pending-beat slot, and a running gesture defers the next — so the
        // ceiling is one gesture per gesture length, never a strobe. And the
        // dot is not lying while it is up: the fetch really did fail.
        //
        // `connection` cannot flap on its own today, because nothing retries
        // the handshake: it goes connecting → connected | error and then waits
        // for something to call connect() again. If a fix for the mid-session
        // gap above adds polling, re-read this: the `connecting` branch in
        // `isErrorSourceBroken` already holds the dot steady across retries,
        // so only genuinely intermittent connectivity would flap, which is
        // exactly what the dot is for.
        //
        // So: revisit if someone reports the launcher going red without a
        // lasting cause, and start with `threads`.
        this.errorSignalArmed[source] = true;
        continue;
      }
      if (!this.errorSignalArmed[source]) continue;
      this.errorSignalArmed[source] = false;
      this.errorSignalViewedSources.delete(source);
      this.retireSignal(source);
    }

    this.onErrorSignalsChanged(wasArmed);
  }

  /**
   * Applies the rising-edge rule after a latch changed.
   *
   * The beat fires on the transition from "no failure" to "at least one
   * failure", evaluated globally across the sources and never again while
   * anything is red — one root cause, one nudge.
   */
  private onErrorSignalsChanged(wasArmed: boolean): void {
    const isArmed = this.hasArmedErrorSignal();
    if (!isArmed) {
      // Nothing is red, so the next outage is a new outage — and gets its own
      // beat, its own pill and its own answer about whether there was room.
      this.errorBeatSpent = false;
      this.pillOutcome = null;
      return;
    }
    if (wasArmed || this.errorBeatSpent) return;
    const active = this.getActiveLauncherSignal();
    if (active !== null && isErrorSignalKey(active)) {
      this.startSignalPulse(active);
    }
  }

  /**
   * Records `oss.inspector.error_signal_viewed` once per source per outage,
   * when the dot is actually on screen.
   *
   * Unlike the announcement's launcher event this fires immediately rather
   * than waiting for the runtime handshake to report `telemetryDisabled`.
   * The held-queue would never drain for the connection source — a connection
   * failure means the handshake did not complete — so queuing would guarantee
   * zero data for the case this event exists to measure. `trackOpened` already
   * sends on the same terms. Both opt-out layers still gate it: the local
   * opt-out inside `track`, and the runtime's flag once it is known.
   */
  private maybeTrackErrorSignalViewed(): void {
    if (
      this.isOpen ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const active = this.getActiveLauncherSignal();
    if (active === null || !isErrorSignalKey(active)) return;
    if (this.errorSignalViewedSources.has(active)) return;
    // Held until this outage's pill has either opened or been suppressed,
    // because `label` IS that answer and the launcher can be on screen a frame
    // before the room around it has been measured. A signal that declares no
    // pill has no answer to wait for.
    if (
      this.pillOutcome === null &&
      LAUNCHER_SIGNALS[active].pillLabel !== undefined
    ) {
      return;
    }
    if (this.core?.telemetryDisabled) return;
    this.errorSignalViewedSources.add(active);
    trackErrorSignalViewed({
      source: active,
      presentation: this.isReducedMotionPreferred()
        ? "reduced_motion"
        : "animated",
      // Whether this outage's pill actually opened. The design deliberately
      // leaves the no-room case silent, and a degradation whose frequency is
      // unknown is a degradation that gets argued about later. Two fixed
      // values, never free text.
      label: this.pillOutcome ?? "suppressed",
    });
  }

  private maybeTrackNewsSignalViewed(): void {
    if (
      !this.newsSignalArmed ||
      this.pulsingSignal !== NEWS_SIGNAL_ID ||
      this.isOpen ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    if (!this.announcement) return;
    this.announcementTelemetry.recordLauncherPulse(
      this.announcement,
      typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "reduced_motion"
        : "animated",
    );
    this.flushAnnouncementTelemetry();
  }

  private isAnnouncementVisible(): boolean {
    return (
      this.isOpen &&
      !this.settingsOpen &&
      this.selectedMenu === WHATS_NEW_MENU_KEY &&
      Boolean(this.announcement?.documentHtml)
    );
  }

  private maybeCompleteWhatsNewView(): void {
    if (!this.isAnnouncementVisible() || !this.announcement) return;
    this.announcementTelemetry.recordView(this.announcement);
    this.flushAnnouncementTelemetry();
    this.clearNewsSignal();
  }

  private flushAnnouncementTelemetry(): void {
    this.announcementTelemetry.flush(
      this.runtimeStatus === CopilotKitCoreRuntimeConnectionStatus.Connected,
      this.core?.telemetryDisabled ?? false,
    );
  }

  private ensureAnnouncementLoading(): void {
    if (
      this.announcementPromise ||
      typeof window === "undefined" ||
      typeof fetch === "undefined"
    ) {
      return;
    }
    this.announcementPromise = this.fetchAnnouncement();
  }

  private async fetchAnnouncement(): Promise<void> {
    const projection = await loadAnnouncementFeed();
    this.announcementLoaded = true;
    if (projection.status === "ready") {
      this.announcement = projection;
      if (projection.shouldArm) {
        this.armNewsSignal({ pulse: projection.shouldPulse });
      }
    }
    this.requestUpdate();
  }

  private handleAnnouncementContentClick = (event: Event): void => {
    const link = announcementLinkFromClick(event);
    if (!link || !this.announcement) return;
    const href = link.getAttribute("href");
    if (href) link.setAttribute("href", this.appendRefParam(href));
    this.announcementTelemetry.recordBodyClick(
      this.announcement,
      this.runtimeStatus === CopilotKitCoreRuntimeConnectionStatus.Connected,
      this.core?.telemetryDisabled ?? false,
    );
  };

  private appendRefParam(href: string, ref = "cpk-inspector"): string {
    try {
      const isRootRelative = href.startsWith("/") && !href.startsWith("//");
      const url = new URL(
        href,
        typeof window !== "undefined"
          ? window.location.href
          : "https://copilotkit.ai",
      );
      if (!url.searchParams.has("ref")) {
        url.searchParams.append("ref", ref);
      }
      // Propagate the inspector's anonymous distinct-ID so the website /
      // Ops API can call posthog.alias(...) on signup-flow landing and
      // close the whats_new_viewed → whats_new_clicked → signup_attributed
      // funnel. Returns null when the user has opted out, so opt-out
      // suppresses cross-domain ID leaks too.
      if (
        !url.searchParams.has("posthog_distinct_id") &&
        this.runtimeStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Connected &&
        !this.core?.telemetryDisabled &&
        this.isCopilotKitDestination(url)
      ) {
        const distinctId = getTelemetryDistinctIdForUrl();
        if (distinctId) {
          url.searchParams.append("posthog_distinct_id", distinctId);
        }
      }
      if (isRootRelative) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
      return url.toString();
    } catch {
      return href;
    }
  }

  private isCopilotKitDestination(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();
    return hostname === "copilotkit.ai" || hostname.endsWith(".copilotkit.ai");
  }
}

// `customElements` is missing during SSR and in torn-down DOM test
// environments. Resolve it when this function is called so registration can
// be retried once a browser registry becomes available.
export function defineWebInspector(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (!registry) return;

  defineElementOnce(
    registry,
    INSPECTOR_COPY_BUTTON_TAG,
    InspectorCopyButtonElement,
  );
  defineElementOnce(
    registry,
    INSPECTOR_JSON_VIEWER_TAG,
    InspectorJsonViewerElement,
  );
  defineElementOnce(registry, "cpk-thread-list", CpkThreadList);
  defineElementOnce(registry, THREAD_INSPECTOR_TAG, CpkThreadInspector);
  defineElementOnce(registry, "cpk-thread-details", ɵCpkThreadDetails);
  defineElementOnce(registry, "cpk-memory-list", LearningMemoryList);
  defineElementOnce(registry, WEB_INSPECTOR_TAG, WebInspectorElement);
}

/**
 * Bind a host-owned core before an Inspector is connected to the DOM. Disabling
 * auto-attachment first prevents `connectedCallback` from briefly selecting a
 * different global core.
 */
export function configureWebInspectorElement(
  inspector: WebInspectorElement,
  core: CopilotKitCore | null,
): WebInspectorElement {
  inspector.autoAttachCore = false;
  inspector.core = core;
  return inspector;
}

defineWebInspector();

declare global {
  interface HTMLElementTagNameMap {
    "cpk-web-inspector": WebInspectorElement;
  }
}
