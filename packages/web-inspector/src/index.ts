import { LitElement, css, html, nothing, render, unsafeCSS } from "lit";
import type { TemplateResult } from "lit";
import { marked } from "marked";
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
  createInspectorThreadRequestId,
  emitInspectorStopViewing,
  emitInspectorViewThread,
  isInspectorThreadBridgeEnabled,
  onInspectorActiveThread,
  onInspectorViewThreadResult,
  ɵselectThreads,
  ɵselectThreadsIsLoading,
  ɵselectThreadsError,
  ɵcreateThreadStore,
  ɵselectMemories,
  ɵselectMemoriesIsLoading,
  ɵselectMemoriesError,
  ɵselectMemoriesAvailable,
  ɵselectMemoriesRealtimeStatus,
} from "@copilotkit/core";
import type {
  CopilotKitCoreSubscriber,
  ɵThreadStore,
  ɵThread,
  Memory,
  MemoryRealtimeStatus,
  RuntimeLicenseStatus,
} from "@copilotkit/core";
import type { AbstractAgent, AgentSubscriber, Message } from "@ag-ui/client";
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
  clearLegacyAnnouncementReadState,
  loadAnnouncementPulsedTimestamp,
  loadAnnouncementReadTimestamp,
  loadInspectorState,
  saveAnnouncementPulsedTimestamp,
  saveAnnouncementReadTimestamp,
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
import { projectInspectorMetadata } from "./lib/inspector-metadata.js";
import type {
  InspectorMetadataAction,
  InspectorMetadataProjection,
} from "./lib/inspector-metadata.js";
import {
  buildHomeModel,
  runtimeConnectionNeedsAttention,
} from "./lib/home-briefing.js";
import type {
  HomeHeroAction,
  HomeModel,
  HomeRuntimeHealthTone,
} from "./lib/home-briefing.js";
import {
  INSPECTOR_GROUPS,
  INSPECTOR_NAV_SECTIONS,
  getGroupForMenu,
  isInspectorMenuKey,
  shouldUseIconRail,
} from "./lib/inspector-nav.js";
import type { InspectorNavGroupKey, MenuKey } from "./lib/inspector-nav.js";
import { selectVisibleRealThreadId } from "./lib/thread-selection.js";
import {
  TELEMETRY_DOCS_URL,
  ensureTelemetryDistinctId,
  getRuntimeUrlType,
  getTelemetryDistinctIdForUrl,
  maybeShowDisclosure,
  trackErrorSignalViewed,
  trackHomeCtaClicked,
  trackHomeViewed,
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
  trackMemoriesTabClicked,
  trackThreadsTabClicked,
  trackThreadsTalkToEngineerClicked,
  trackWhatsNewClicked,
  trackWhatsNewSignalViewed,
  trackWhatsNewViewed,
} from "./lib/telemetry.js";
import type {
  ExampleKind,
  ExampleTourStep,
  ExampleTourTab,
  InspectorGroupKey,
  InspectorMetadataLicenseBucket,
  InspectorMetadataModuleViewedTelemetryProps,
  InspectorMetadataTelemetryModule,
  InspectorMemoryTelemetryProps,
  InspectorErrorSignalSource,
  InspectorEventErrorSource,
  InspectorWiringErrorSource,
  InspectorOpenSource,
  InspectorThreadTelemetryProps,
  MetadataActionPlacement,
  ThreadsExpiryBucket,
  ThreadsUsageBucket,
  WhatsNewSignalPresentation,
  WhatsNewSurface,
} from "./lib/telemetry.js";

export type { Anchor } from "./lib/types.js";
export { buildCapabilityRows as ɵbuildCapabilityRows };
export type { CapabilityToolRow as ɵCapabilityToolRow };

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
 * User-facing label for the learning view. The legacy menu key stays
 * "memories" for persistence and telemetry stability.
 */
const LEARNING_VIEW_LABEL = "Learning";

/**
 * User-facing label for the What's new view. Its menu key stays `whats-new`
 * for persistence and telemetry stability, following the `memories`/"Memory"
 * precedent above.
 */
const WHATS_NEW_VIEW_LABEL = "What's new";

/** Menu key of the What's new leaf — the news signal's destination. */
const WHATS_NEW_MENU_KEY = "whats-new";

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
const MEMORY_LOAD_ERROR_LABEL = "Failed to load learning data";

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

type LauncherHudRowId = "inspector" | "threads" | "intelligence" | "learning";

const HUD_OPEN_INSPECTOR_LABEL = "Open Inspector";
const HUD_THREADS_OFF_LABEL = "Turn on Threads";
const HUD_THREADS_ON_LABEL = "Threads on";
const HUD_INTELLIGENCE_OFF_LABEL = "Turn on Intelligence";
const HUD_INTELLIGENCE_ON_LABEL = "Intelligence connected";
const HUD_THREADS_OFF_DETAIL = "Inspect conversations from this app.";
const HUD_THREADS_ON_DETAIL = "Threads is on. Opens the Threads view.";
const HUD_INTELLIGENCE_OFF_DETAIL =
  "Connect Intelligence to use Threads and Learning.";
const HUD_INTELLIGENCE_ON_DETAIL = "Intelligence is connected. Opens Home.";
const HUD_LEARNING_OFF_LABEL = "Turn on Learning";
const HUD_LEARNING_ON_LABEL = "Learning on";
const HUD_LEARNING_OFF_DETAIL = "Connect Intelligence to use Learning.";
const HUD_LEARNING_ON_DETAIL = "Learning is on. Opens the Learning view.";
const HUD_OPEN_INSPECTOR_DETAIL =
  "Same as clicking the circle. Opens the full Inspector.";

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
const THREAD_LIST_DEBOUNCE_MS = 300;

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
const LAUNCHER_HUD_WIDTH = 248;
const DRAG_THRESHOLD = 6;
const MIN_WINDOW_WIDTH = 880;
const MIN_WINDOW_WIDTH_DOCKED_LEFT = 640;
const MIN_WINDOW_HEIGHT = 480;
const INSPECTOR_STORAGE_KEY = "cpk:inspector:state";
const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";
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
const MAX_AGENT_EVENTS = 200;
const INTERACTIVE_FOCUS_BASE_STYLE =
  "outline-style:solid;outline-width:2px;outline-color:transparent;outline-offset:2px;cursor:pointer;";
// Cap on banner impressions held while waiting for the runtime handshake, so a
// runtime that never connects can't accumulate an unbounded queue.
const MAX_PENDING_BANNER_VIEWED = 20;
const MAX_TOTAL_EVENTS = 500;
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
const THREADS_DOCS_URL = "https://docs.copilotkit.ai/threads";
const THREADS_RUNTIME_SETUP_DOCS_URL =
  "https://docs.copilotkit.ai/backend/runtime-endpoints#enable-rich-threads-routes";
const THREADS_RUNTIME_SETUP_PROMPT = [
  `Read ${THREADS_RUNTIME_SETUP_DOCS_URL} and finish setting up Rich Threads in this repository.`,
  "",
  "First inspect the repository's agent instructions, installed CopilotKit versions, Runtime adapter, frontend provider, route or proxy setup, and existing authentication. Preserve the current framework and deployment model. Preserve existing authentication middleware and access checks on every Runtime route.",
  "",
  "Follow the guide to enable the multi-route Runtime, align the frontend transport, scope identifyUser to the existing server-verified signed-in application user, and expose the full Runtime subtree for GET, POST, PATCH, and DELETE. Never use a fixed demo identity in production. If no trusted user identity exists, stop and ask me which auth source to use.",
  "",
  "Start the app and verify GET {basePath}/info reports threadEndpoints.list, inspect, mutations, and realtimeMetadata as true. Run focused tests, lint, and typecheck. Report the files changed, commands run, and verification result. If blocked, explain the missing input; do not invent setup.",
].join("\n");
const SELF_HOSTED_INTELLIGENCE_URL =
  "https://docs.copilotkit.ai/premium/self-hosting";
const THREADS_EXAMPLE_OVERVIEW_VIDEO_URL =
  "https://cdn.copilotkit.ai/corp-site/videos/copilotkit-generative-ui-agentic-frontend-demo.webm";
const THREADS_EXAMPLE_OVERVIEW_VIDEO_FALLBACK =
  "The demo video is unavailable. Use the example threads to explore Messages, AG-UI Events, and State.";
const THREADS_EXAMPLE_TOUR_STORAGE_KEY =
  "cpk:inspector:threads-example-tour:v1";
const THREADS_EXAMPLE_AGENT_ID = "threads-feature";

type ThreadServiceStatus = "available" | "unavailable" | "unknown" | "error";
type ThreadsExampleOverviewVideoState =
  | "deferred"
  | "ready"
  | "playing"
  | "failed";
type ThreadsSetupPromptCopyState = "idle" | "copied" | "error";
type ThreadsExampleOverviewVideoListeners = Readonly<{
  loadeddata: EventListener;
  play: EventListener;
  pause: EventListener;
  error: EventListener;
}>;

type ThreadStoreStatus = Readonly<{
  error: Error | null;
  isLoading: boolean;
}>;

/** Keep one row per thread id when flattening per-agent stores. */
function uniqueThreadsById(threads: ɵThread[]): ɵThread[] {
  const seen = new Set<string>();
  const unique: ɵThread[] = [];
  for (const thread of threads) {
    if (seen.has(thread.id)) {
      continue;
    }
    seen.add(thread.id);
    unique.push(thread);
  }
  return unique;
}

function flattenThreadsByAgent(
  threadsByAgent: Map<string, ɵThread[]>,
): ɵThread[] {
  return uniqueThreadsById(Array.from(threadsByAgent.values()).flat());
}

/**
 * Selects the Thread store status with a stable object identity so loading-only
 * transitions reach one of the Inspector's two existing store subscriptions.
 */
function createThreadStoreStatusSelector(): (
  state: ReturnType<ɵThreadStore["getState"]>,
) => ThreadStoreStatus {
  let previousError: Error | null | undefined;
  let previousIsLoading: boolean | undefined;
  let previousStatus: ThreadStoreStatus | undefined;

  return (state) => {
    const error = ɵselectThreadsError(state);
    const isLoading = ɵselectThreadsIsLoading(state);
    if (
      previousStatus &&
      previousError === error &&
      previousIsLoading === isLoading
    ) {
      return previousStatus;
    }

    previousError = error;
    previousIsLoading = isLoading;
    previousStatus = { error, isLoading };
    return previousStatus;
  };
}

type InspectorAgentEventType =
  | "RUN_STARTED"
  | "RUN_FINISHED"
  | "RUN_ERROR"
  | "STEP_STARTED"
  | "STEP_FINISHED"
  | "TEXT_MESSAGE_START"
  | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END"
  | "TOOL_CALL_RESULT"
  | "STATE_SNAPSHOT"
  | "STATE_DELTA"
  | "MESSAGES_SNAPSHOT"
  | "RAW_EVENT"
  | "CUSTOM_EVENT"
  | "REASONING_START"
  | "REASONING_MESSAGE_START"
  | "REASONING_MESSAGE_CONTENT"
  | "REASONING_MESSAGE_END"
  | "REASONING_END"
  | "REASONING_ENCRYPTED_VALUE"
  | "ACTIVITY_SNAPSHOT"
  | "ACTIVITY_DELTA";

const AGENT_EVENT_TYPES: readonly InspectorAgentEventType[] = [
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "STEP_STARTED",
  "STEP_FINISHED",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "MESSAGES_SNAPSHOT",
  "RAW_EVENT",
  "CUSTOM_EVENT",
  "REASONING_START",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END",
  "REASONING_END",
  "REASONING_ENCRYPTED_VALUE",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
] as const;

type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | SanitizedValue[]
  | { [key: string]: SanitizedValue };

type InspectorToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: SanitizedValue | string;
  };
  toolName?: string;
  status?: string;
};

type InspectorMessage = {
  id?: string;
  role: string;
  contentText: string;
  contentRaw?: SanitizedValue;
  toolCalls: InspectorToolCall[];
  toolCallId?: string;
  /** Populated for role="activity" messages (Generative UI). */
  activityType?: string;
};

type InspectorToolDefinition = {
  agentId: string;
  name: string;
  description?: string;
  parameters?: unknown;
  type: "handler" | "renderer";
};

// ─── Capabilities tab view-models ────────────────────────────────────────────
// A single toggle row. `key` is the stable identity used as a Lit list key; for
// tools it is `${agentId}:${name}` (agentId "" for global tools), for catalog
// components it is the component name.
type CapabilityToolRow = {
  key: string;
  name: string;
  description?: string;
  agentId?: string;
  enabled: boolean;
};

// Minimal structural view of CopilotKitCore that the pure helper needs, so
// buildCapabilityRows is trivially unit-testable with a plain object. Method
// names MUST match the A1 contract exactly.
type CapabilityToolSource = {
  tools?: ReadonlyArray<{
    name: string;
    description?: string;
    agentId?: string;
  }>;
  isToolEnabled: (name: string, agentId?: string) => boolean;
};

/**
 * Map core.tools (the registry INCLUDING disabled tools) into Capabilities-tab
 * frontend-tool rows. Pure: no DOM, no `this`. Reads current on/off state from
 * core.isToolEnabled(name, agentId?) per the A1 contract.
 */
function buildCapabilityRows(core: CapabilityToolSource): CapabilityToolRow[] {
  const rows: CapabilityToolRow[] = [];
  for (const tool of core.tools ?? []) {
    const agentId = tool.agentId ?? "";
    const key = `${agentId}:${tool.name}`;
    rows.push({
      key,
      name: tool.name,
      description: tool.description,
      agentId: tool.agentId,
      enabled: core.isToolEnabled(tool.name, tool.agentId),
    });
  }
  return rows.sort((a, b) => {
    const agentCompare = (a.agentId ?? "").localeCompare(b.agentId ?? "");
    if (agentCompare !== 0) return agentCompare;
    return a.name.localeCompare(b.name);
  });
}

type InspectorEvent = {
  id: string;
  agentId: string;
  type: InspectorAgentEventType;
  timestamp: number;
  payload: SanitizedValue;
};

// ─── Thread details types ────────────────────────────────────────────────────

export type ThreadDebuggerProviderLoadOptions = {
  signal: AbortSignal;
};

export type ThreadDebuggerToolCall = {
  id: string;
  name: string;
  args: string | Record<string, unknown>;
};

export type ThreadDebuggerMessage = {
  id: string;
  role: string;
  content?: string;
  toolCalls?: ThreadDebuggerToolCall[];
  toolCallId?: string;
  /** Present when role === "activity" (Generative UI output). */
  activityType?: string;
};

export type ThreadDebuggerEvent = {
  type: string;
  timestamp: string | number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ThreadDebuggerMetadata = {
  id: string;
  name?: string | null;
  agentId?: string | null;
  endUserId?: string | null;
  createdById?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ThreadDebuggerProvider = {
  getThreadMetadata?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerMetadata | null>;
  getMessages?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerMessage[]>;
  getEvents?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerEvent[]>;
  getState?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<Record<string, unknown> | null>;
};

interface ConversationUser {
  id: string;
  type: "user";
  content: string;
  createdAt: string;
}

interface ConversationAssistant {
  id: string;
  type: "assistant";
  content: string;
  createdAt: string;
}

interface ConversationToolCall {
  id: string;
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  groupId?: string;
}

interface ConversationReasoning {
  id: string;
  type: "reasoning";
  duration: string;
  createdAt: string;
}

interface ConversationStateUpdate {
  id: string;
  type: "state_update";
  createdAt: string;
}

interface ConversationAgentResponded {
  id: string;
  type: "agent_responded";
  createdAt: string;
}

interface ConversationGenerativeUIItem {
  id: string;
  type: "generative-ui";
  activityType: string;
  createdAt: string;
}

interface ToolCallGroup {
  type: "tool_call_group";
  id: string;
  items: ConversationToolCall[];
}

type ConversationItem =
  | ConversationUser
  | ConversationAssistant
  | ConversationToolCall
  | ConversationReasoning
  | ConversationStateUpdate
  | ConversationAgentResponded
  | ConversationGenerativeUIItem;

type RenderItem = ConversationItem | ToolCallGroup;

interface ApiAgentEvent {
  type: string;
  timestamp: string | number;
  payload: Record<string, unknown>;
  sourceIndex?: number;
  rawEvent?: ThreadDebuggerEvent;
}

type ThreadDetailsTab = "timeline" | "state" | "raw-events";
type ThreadDetailsPanelCacheSlot = ThreadDetailsTab | "timeline-fallback";

type TimelineItemKind =
  | "message"
  | "tool"
  | "state"
  | "run"
  | "event"
  | "warning";

type TimelineItem = {
  id: string;
  messageId?: string;
  kind: TimelineItemKind;
  title: string;
  body?: string;
  timestamp: string | number;
  sourceIndex: number;
  severity?: "warning" | "error";
  details?: Record<string, unknown>;
};

type RuntimeEventsFetchResult =
  | { status: "available"; events: ThreadDebuggerEvent[] }
  | { status: "not-available" };

type RuntimeStateFetchResult =
  | { status: "available"; state: Record<string, unknown> | null }
  | { status: "not-available" };

type ExampleThread = ɵThread & { isExample: true };

type ExampleThreadDetails = {
  messages: ThreadDebuggerMessage[];
  events: ThreadDebuggerEvent[];
  state: Record<string, unknown>;
};

const THREADS_EXAMPLE_THREADS: ExampleThread[] = [
  {
    id: "example-realtime-sync",
    name: "Realtime thread sync",
    agentId: THREADS_EXAMPLE_AGENT_ID,
    organizationId: "example-organization",
    createdById: "example-user",
    archived: false,
    createdAt: "2026-07-08T16:00:00.000Z",
    updatedAt: "2026-07-08T16:30:00.000Z",
    isExample: true,
  },
  {
    id: "example-manage-history",
    name: "Manage saved conversations",
    agentId: THREADS_EXAMPLE_AGENT_ID,
    organizationId: "example-organization",
    createdById: "example-user",
    archived: false,
    createdAt: "2026-07-07T17:45:00.000Z",
    updatedAt: "2026-07-07T18:15:00.000Z",
    isExample: true,
  },
  {
    id: "example-inspect-runs",
    name: "Inspect durable run history",
    agentId: THREADS_EXAMPLE_AGENT_ID,
    organizationId: "example-organization",
    createdById: "example-user",
    archived: false,
    createdAt: "2026-07-06T20:15:00.000Z",
    updatedAt: "2026-07-06T20:45:00.000Z",
    isExample: true,
  },
];

/** Map Sam's fixed example IDs to a closed telemetry vocabulary. */
function getExampleKind(threadId: string): ExampleKind | undefined {
  switch (threadId) {
    case "example-realtime-sync":
      return "realtime_sync";
    case "example-manage-history":
      return "manage_history";
    case "example-inspect-runs":
      return "inspect_runs";
    default:
      return undefined;
  }
}

const THREADS_EXAMPLE_DETAILS: Record<string, ExampleThreadDetails> = {
  "example-realtime-sync": {
    messages: [
      {
        id: "example-sync-user",
        role: "user",
        content: "Resume the checkout support thread from yesterday.",
      },
      {
        id: "example-sync-assistant",
        role: "assistant",
        content:
          "I found the saved thread, restored the cart state, and continued from the latest user message.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-08T16:30:00.000Z",
        payload: {
          threadId: "example-realtime-sync",
          agentId: THREADS_EXAMPLE_AGENT_ID,
        },
      },
      {
        type: "MESSAGES_SNAPSHOT",
        timestamp: "2026-07-08T16:30:01.000Z",
        payload: {
          messageCount: 6,
          source: "thread-history",
        },
      },
      {
        type: "STATE_SNAPSHOT",
        timestamp: "2026-07-08T16:30:02.000Z",
        payload: {
          cartId: "cart_demo_42",
          checkoutStep: "shipping",
          resumed: true,
        },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-08T16:30:04.000Z",
        payload: {
          status: "completed",
        },
      },
    ],
    state: {
      cartId: "cart_demo_42",
      checkoutStep: "shipping",
      userIntent: "resume_previous_checkout",
      persistedThread: true,
    },
  },
  "example-manage-history": {
    messages: [
      {
        id: "example-history-user",
        role: "user",
        content: "Rename this saved support conversation for the handoff.",
      },
      {
        id: "example-history-assistant",
        role: "assistant",
        content:
          "Renamed the thread and kept the prior messages available for the next session.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-07T18:15:00.000Z",
        payload: {
          threadId: "example-manage-history",
          agentId: THREADS_EXAMPLE_AGENT_ID,
        },
      },
      {
        type: "CUSTOM_EVENT",
        timestamp: "2026-07-07T18:15:01.000Z",
        payload: {
          action: "thread_renamed",
          previousName: "Untitled",
          name: "Billing escalation handoff",
        },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-07T18:15:03.000Z",
        payload: {
          status: "completed",
        },
      },
    ],
    state: {
      name: "Billing escalation handoff",
      savedMessages: 14,
      lastHandoff: "support-team",
    },
  },
  "example-inspect-runs": {
    messages: [
      {
        id: "example-inspect-user",
        role: "user",
        content: "Why did the assistant recommend the enterprise plan?",
      },
      {
        id: "example-inspect-assistant",
        role: "assistant",
        content:
          "The recommendation came from the account size, SSO requirement, and audit-log constraint in state.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-06T20:45:00.000Z",
        payload: {
          threadId: "example-inspect-runs",
          agentId: THREADS_EXAMPLE_AGENT_ID,
        },
      },
      {
        type: "TOOL_CALL_START",
        timestamp: "2026-07-06T20:45:01.000Z",
        payload: {
          toolCallId: "call_account_lookup",
          toolName: "lookupAccount",
        },
      },
      {
        type: "TOOL_CALL_RESULT",
        timestamp: "2026-07-06T20:45:02.000Z",
        payload: {
          toolCallId: "call_account_lookup",
          seats: 220,
          requiresSso: true,
        },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-06T20:45:04.000Z",
        payload: {
          status: "completed",
        },
      },
    ],
    state: {
      accountTier: "growth",
      seats: 220,
      requiresSso: true,
      auditLogsRequired: true,
    },
  },
};

const THREADS_EXAMPLE_TOUR_STEPS: ReadonlyArray<{
  tab: ThreadDetailsTab;
  label: string;
  title: string;
  body: string;
}> = [
  {
    tab: "timeline",
    label: "Messages",
    title: "Read the run as a story",
    body: "The timeline turns messages, tool calls, state changes, and run markers into a scannable debugging trail.",
  },
  {
    tab: "raw-events",
    label: "AG-UI Events",
    title: "Drop into the protocol payloads",
    body: "Raw events show the exact AG-UI stream behind the timeline when you need to verify ordering or payload shape.",
  },
  {
    tab: "state",
    label: "State",
    title: "Check the durable state",
    body: "The state tab shows the saved values that make a thread resumable across sessions.",
  },
];

type ExampleTourTelemetryPair = Readonly<{
  tour_step: ExampleTourStep;
  tour_tab: ExampleTourTab;
}>;

/** Return only the three supported tour step/tab pairs. */
function getExampleTourTelemetryPair(
  index: number,
): ExampleTourTelemetryPair | undefined {
  switch (index) {
    case 0:
      return { tour_step: 1, tour_tab: "timeline" };
    case 1:
      return { tour_step: 2, tour_tab: "raw-events" };
    case 2:
      return { tour_step: 3, tour_tab: "state" };
    default:
      return undefined;
  }
}

/** Convert rendered action placement to its stable telemetry key. */
function getMetadataActionPlacement(
  placement: "threads-footer" | "locked",
): MetadataActionPlacement {
  return placement === "threads-footer" ? "threads_footer" : "threads_locked";
}

// ─── JSON syntax highlighter ─────────────────────────────────────────────────
// Inline-styled so shadow DOM encapsulation preserves colors when the output
// is injected via unsafeHTML. Only for structured data — never raw user HTML.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Memoize highlight output by payload reference. Tab switches cause Lit to
// re-render the active panel from scratch, and the JSON.stringify + regex
// pass below is by far the most expensive thing in the events / state
// panels (potentially MB of agent state). Caching by object reference
// turns subsequent renders of an unchanged event list into near-zero JS work.
const highlightedJsonCache = new WeakMap<object, string>();

function highlightedJson(obj: unknown): string {
  if (typeof obj === "object" && obj !== null) {
    const cached = highlightedJsonCache.get(obj);
    if (cached !== undefined) return cached;
  }
  const colors = {
    key: "#5558B2",
    str: "#087653",
    num: "#8a5900",
    bool: "#c0333a",
    nil: "#68686e",
  };
  const json = JSON.stringify(obj, null, 2);
  if (!json) return "";
  const parts: string[] = [];
  let lastIndex = 0;
  const re =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(json)) !== null) {
    parts.push(escapeHtml(json.slice(lastIndex, match.index)));
    const m = match[0];
    let color = colors.num;
    if (m.startsWith('"')) {
      color = m.trimEnd().endsWith(":") ? colors.key : colors.str;
    } else if (m === "true" || m === "false") {
      color = colors.bool;
    } else if (m === "null") {
      color = colors.nil;
    }
    parts.push(`<span style="color:${color}">${escapeHtml(m)}</span>`);
    lastIndex = match.index + m.length;
  }
  parts.push(escapeHtml(json.slice(lastIndex)));
  const result = parts.join("");
  if (typeof obj === "object" && obj !== null) {
    highlightedJsonCache.set(obj, result);
  }
  return result;
}

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

function renderHighlightedJsonBlock(
  value: unknown,
  options: { maxHeight?: string } = {},
) {
  const parsed = coerceJsonValue(value);
  const style = options.maxHeight
    ? `max-height:${options.maxHeight}`
    : undefined;
  return html`<pre class="cpk-json-block" style=${style || nothing}>
${unsafeHTML(highlightedJson(parsed))}</pre
  >`;
}

function eventColors(type: string): { bg: string; fg: string } {
  if (type.startsWith("TEXT_MESSAGE")) return { bg: "#EEE6FE", fg: "#57575B" };
  if (type.startsWith("TOOL_CALL"))
    return { bg: "rgba(133,236,206,0.15)", fg: "#087653" };
  if (type.startsWith("STATE"))
    return { bg: "rgba(190,194,255,0.102)", fg: "#5558B2" };
  if (type === "RUN_ERROR" || type === "ERROR")
    return { bg: "rgba(250,95,103,0.13)", fg: "#c0333a" };
  if (type.startsWith("RUN_") || type.startsWith("STEP_"))
    return { bg: "rgba(255,172,77,0.2)", fg: "#8a5900" };
  return { bg: "#F7F7F9", fg: "#68686e" };
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

/**
 * Lit's constructable stylesheets belong to the document that created them.
 * These child elements move between the app and pop-out documents, so keep
 * their styles as shadow-root style nodes that travel with the live element.
 */
abstract class PortableLitElement extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const elementClass = this.constructor as unknown as {
      elementStyles: readonly (CSSStyleSheet | { cssText: string })[];
      shadowRootOptions: ShadowRootInit;
    };
    const renderRoot =
      this.shadowRoot ?? this.attachShadow(elementClass.shadowRootOptions);

    for (const style of elementClass.elementStyles) {
      const styleElement = this.ownerDocument.createElement("style");
      styleElement.textContent =
        "cssText" in style
          ? style.cssText
          : Array.from(style.cssRules, (rule) => rule.cssText).join("");
      renderRoot.append(styleElement);
    }

    return renderRoot;
  }
}

// ─── cpk-thread-list ────────────────────────────────────────────────────────

class CpkThreadList extends PortableLitElement {
  static properties = {
    threads: { attribute: false },
    selectedThreadId: { attribute: false },
    inAppThreadId: { attribute: false },
    errorMessage: { attribute: false },
    suppressEmptyState: { attribute: false },
    _query: { state: true },
  };
  threads: ɵThread[] = [];
  selectedThreadId: string | null = null;
  inAppThreadId: string | null = null;
  /**
   * Non-null when the underlying thread store reported a load error
   * (REST list rejection, Phoenix subscribe failure, retry exhaustion).
   * Surfaced inline so users see a real error state instead of stale or
   * empty data with no indication of what went wrong.
   */
  errorMessage: string | null = null;
  suppressEmptyState = false;
  private _query = "";

  static styles = css`
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .cpk-tl {
      font-family: "Plus Jakarta Sans", sans-serif;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: #f7f7f9;
    }

    /* ── Search ── */
    .cpk-tl__search {
      padding: 10px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
    }

    .cpk-tl__search-input {
      width: 100%;
      box-sizing: border-box;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid #dbdbe5;
      background: #ffffff;
      color: #010507;
      outline: none;
      transition: border-color 0.15s;
    }

    .cpk-tl__search-input:focus {
      border-color: #bec2ff;
    }

    /* ── List ── */
    .cpk-tl__list {
      flex: 1;
      overflow-y: auto;
    }

    /* ── Thread item ── */
    .cpk-tl__item {
      appearance: none;
      display: block;
      box-sizing: border-box;
      width: 100%;
      margin: 0;
      border: 0;
      border-radius: 0;
      padding: 11px 13px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      border-bottom: 1px solid #e9e9ef;
      border-left: 3px solid transparent;
      transition: background 0.1s;
    }

    .cpk-tl__item:hover {
      background: #ffffff;
    }

    .cpk-tl__item--active {
      background: #bec2ff1a;
      border-left-color: #bec2ff;
    }

    .cpk-tl__item--active:hover {
      background: #bec2ff33;
    }

    .cpk-tl__item:focus-visible {
      outline-color: #5558b2;
      outline-offset: -2px;
      outline-style: solid;
      outline-width: 2px;
    }

    .cpk-tl__row1 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 3px;
    }

    .cpk-tl__name {
      font-size: 12px;
      font-weight: 500;
      color: #010507;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cpk-tl__name--unnamed {
      color: #68686e;
      font-style: italic;
      font-weight: 400;
    }

    .cpk-tl__time {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      color: #68686e;
      flex-shrink: 0;
    }

    .cpk-tl__meta {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }

    .cpk-tl__pill {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      padding: 1px 7px;
      border-radius: 5px;
      text-transform: uppercase;
      font-weight: 500;
      white-space: nowrap;
      background: #eee6fe;
      color: #57575b;
    }

    .cpk-tl__pill--example {
      background: rgba(133, 236, 206, 0.22);
      color: #087653;
    }

    .cpk-tl__pill--in-app {
      background: #bec2ff;
      color: #010507;
    }

    /* ── Empty state ── */
    .cpk-tl__empty {
      padding: 32px 16px;
      text-align: center;
      color: #68686e;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .cpk-tl__empty-icon {
      color: #c0c0c8;
    }

    :host([data-color-scheme="dark"]) {
      color-scheme: dark;
    }

    :host([data-color-scheme="dark"]) .cpk-tl {
      background: #15171e;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-tl__search,
    :host([data-color-scheme="dark"]) .cpk-tl__item {
      border-color: #343742;
    }

    :host([data-color-scheme="dark"]) .cpk-tl__search-input {
      border-color: #464957;
      background: #191c24;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-tl__item:hover {
      background: #20232d;
    }

    :host([data-color-scheme="dark"]) .cpk-tl__item--active,
    :host([data-color-scheme="dark"]) .cpk-tl__item--active:hover {
      background: #292b43;
      border-left-color: #8f93df;
    }

    :host([data-color-scheme="dark"]) .cpk-tl__name {
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-tl__name--unnamed,
    :host([data-color-scheme="dark"]) .cpk-tl__time,
    :host([data-color-scheme="dark"]) .cpk-tl__empty {
      color: #aeb1bd;
    }

    :host([data-color-scheme="dark"]) .cpk-tl__pill {
      background: #302b43;
      color: #d8d9ff;
    }
  `;

  private relativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }

  private get filtered(): ɵThread[] {
    const q = this._query.toLowerCase();
    if (!q) return this.threads;
    return this.threads.filter(
      (t) =>
        (t.name?.toLowerCase().includes(q) ?? false) ||
        t.agentId.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q),
    );
  }

  private onThreadClick(threadId: string): void {
    this.dispatchEvent(
      new CustomEvent("threadSelected", {
        detail: threadId,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onSearchInput = (event: Event): void => {
    this._query = (event.target as HTMLInputElement).value;
  };

  render() {
    const filtered = this.filtered;
    return html`
      <div class="cpk-tl">
        <!-- Search -->
        <div class="cpk-tl__search">
          <input
            type="text"
            placeholder="Search threads…"
            .value=${this._query}
            @input=${this.onSearchInput}
            class="cpk-tl__search-input"
          />
        </div>

        <!-- Thread list -->
        <div class="cpk-tl__list">
          ${filtered.map(
            (thread) => html`
              <button
                type="button"
                aria-current=${
                  this.selectedThreadId === thread.id ? "true" : nothing
                }
                class="cpk-tl__item ${
                  this.selectedThreadId === thread.id
                    ? "cpk-tl__item--active"
                    : ""
                }"
                @click=${() => this.onThreadClick(thread.id)}
              >
                <span class="cpk-tl__row1">
                  <span
                    class="cpk-tl__name ${
                      !thread.name ? "cpk-tl__name--unnamed" : ""
                    }"
                    >${thread.name ?? "Untitled"}</span
                  >
                  <span class="cpk-tl__time"
                    >${this.relativeTime(thread.updatedAt)}</span
                  >
                </span>
                <span class="cpk-tl__meta">
                  <span class="cpk-tl__pill">${thread.agentId}</span>
                  ${
                    (thread as Partial<ExampleThread>).isExample
                      ? html`
                          <span class="cpk-tl__pill cpk-tl__pill--example">Example</span>
                        `
                      : nothing
                  }
                  ${
                    this.inAppThreadId === thread.id
                      ? html`
                          <span class="cpk-tl__pill cpk-tl__pill--in-app">In app</span>
                        `
                      : nothing
                  }
                </span>
              </button>
            `,
          )}
          ${
            filtered.length === 0 && !this.suppressEmptyState
              ? html`
                <div class="cpk-tl__empty">
                  ${
                    this.errorMessage
                      ? html`
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="cpk-tl__empty-icon"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <div>
                          Failed to load threads
                          <div
                            style="font-size:11px;margin-top:4px;color:#c0333a;"
                          >
                            ${this.errorMessage}
                          </div>
                        </div>
                      `
                      : this.threads.length === 0
                        ? html`
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.5"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              class="cpk-tl__empty-icon"
                            >
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            No threads yet
                          `
                        : html`
                            No threads match your search.
                          `
                  }
                </div>
              `
              : nothing
          }
        </div>
      </div>
    `;
  }
}

// ─── cpk-thread-inspector ────────────────────────────────────────────────────
// Renders the selected thread's read-only timeline, state, raw AG-UI events,
// and compact technical metadata. External hosts provide a ThreadDebuggerProvider;
// the legacy CopilotKit Inspector wrapper can still pass runtime URL inputs.
export class CpkThreadInspector extends PortableLitElement {
  static properties = {
    threadId: { attribute: false },
    provider: { attribute: false },
    thread: { attribute: false },
    runtimeUrl: { attribute: false },
    headers: { attribute: false },
    threadInspectionAvailable: { attribute: false },
    agentStateInput: { attribute: false },
    agentEventsInput: { attribute: false },
    liveMessageVersion: { attribute: false },
    viewInAppMode: { attribute: false },
    viewInAppError: { attribute: false },
    focusMessageId: { attribute: false },
    focusRequestId: { attribute: false },
    _tab: { state: true },
    _fetchedMetadata: { state: true },
    _conversation: { state: true },
    _fetchedEvents: { state: true },
    _fetchedState: { state: true },
    _loadingMessages: { state: true },
    _loadingEvents: { state: true },
    _loadingState: { state: true },
    _messagesError: { state: true },
    _eventsError: { state: true },
    _stateError: { state: true },
    _expandedTools: { state: true },
    _expandedMessages: { state: true },
    _expandedTimelineDetails: { state: true },
    _expandedRawEvents: { state: true },
    _showDetailPanel: { state: true },
    _detailPanelWidth: { state: true },
    _eventsNotAvailable: { state: true },
    _stateNotAvailable: { state: true },
    _panelInitializing: { state: true },
    _activatedTabs: { state: true },
  };

  threadId: string | null = null;
  provider: ThreadDebuggerProvider | null = null;
  thread: ThreadDebuggerMetadata | ɵThread | null = null;
  runtimeUrl = "";
  headers: Record<string, string> = {};
  threadInspectionAvailable = false;
  agentStateInput: Record<string, unknown> | null = null;
  agentEventsInput: ApiAgentEvent[] = [];
  /**
   * Monotonic per-thread counter the parent inspector ticks every time the
   * agent currently running on this thread emits a message change. When this
   * prop changes for the same `threadId`, we re-fetch `/threads/:id/messages`
   * so the conversation view reflects live streaming output.
   */
  liveMessageVersion = 0;
  viewInAppMode: "hidden" | "view" | "stop" = "hidden";
  viewInAppError: string | null = null;
  focusMessageId: string | null = null;
  focusRequestId = 0;

  private _tab: ThreadDetailsTab = "timeline";
  private _fetchedMetadata: ThreadDebuggerMetadata | null = null;
  private _conversation: ConversationItem[] = [];
  private _fetchedEvents: ApiAgentEvent[] | null = null;
  private _fetchedState: Record<string, unknown> | null = null;
  private _loadingMessages = false;
  private _loadingEvents = false;
  private _loadingState = false;
  private _messagesError: string | null = null;
  private _eventsError: string | null = null;
  private _stateError: string | null = null;
  private _expandedTools = new Set<string>();
  private _expandedMessages = new Set<string>();
  private _expandedTimelineDetails = new Set<string>();
  private _expandedRawEvents = new Set<string>();
  private _showDetailPanel = false;
  private _detailPanelWidth = 250;
  /** True when the /events endpoint returned 501 — don't fall back to live data. */
  private _eventsNotAvailable = false;
  /** True when the /state endpoint returned 501 — don't fall back to live data. */
  private _stateNotAvailable = false;
  private _scrolledFocusRequestId = 0;
  private _highlightedFocusRequestId = -1;
  /**
   * Briefly true after a tab switch so the active-tab highlight + a generic
   * "Loading…" placeholder paint before the heavy per-tab render runs. Without
   * this, large event/conversation lists block the next paint and the user
   * sees the click as unresponsive for seconds.
   */
  private _panelInitializing = false;
  /**
   * Tabs that have been opened at least once for the current thread. Once a
   * tab is activated, its rendered DOM stays mounted (we hide inactive tabs
   * via display:none) so flipping back to it is just a CSS swap rather than
   * tearing down and rebuilding the entire panel from scratch. Without this,
   * switching back to AG-UI Events on a thread with hundreds of events
   * triggers a multi-second DOM-creation pass each time.
   *
   * Reset to {"timeline"} when the selected thread changes.
   */
  private _activatedTabs: Set<ThreadDetailsTab> = new Set(["timeline"]);
  /**
   * Memoized per-panel templates keyed by the inputs they render from.
   * When the underlying data hasn't changed (same `_conversation` /
   * `_fetchedState` / events array reference, plus expand-state for the
   * conversation panel), we return the previously built TemplateResult.
   * Lit then sees "same template, same values" and skips the diff entirely,
   * so re-rendering on tab switch is near-zero work even when the panel
   * content is large. The key is an opaque tuple compared element-wise by
   * reference; if any element flips, the cache misses and rebuilds.
   */
  private _panelTplCache: Map<
    ThreadDetailsPanelCacheSlot,
    { key: readonly unknown[]; tpl: TemplateResult }
  > = new Map();
  private _timelineItemsCache: {
    events: ApiAgentEvent[];
    items: TimelineItem[];
  } | null = null;
  private _liveEventsWithSourceIndexCache: {
    events: ApiAgentEvent[];
    indexedEvents: ApiAgentEvent[];
  } | null = null;
  /**
   * Tracks whether we've fetched events for the current thread yet. Events
   * fetch lazily on first sub-tab click so a large response's JSON.parse
   * doesn't block the main thread when the user only ever cares about the
   * conversation.
   */
  private _eventsFetched = false;
  /**
   * Tracks whether we've fetched state for the current thread yet. Same
   * lazy-load reasoning as `_eventsFetched`.
   */
  private _stateFetched = false;
  private _lastLoadKey: string | null = null;
  private _lastSeenLiveMessageVersion = 0;
  private _metadataAbort: AbortController | null = null;
  private _messagesAbort: AbortController | null = null;
  private _eventsAbort: AbortController | null = null;
  private _stateAbort: AbortController | null = null;
  private _hasConnectedOnce = false;
  private _dividerResizing = false;
  private _dividerPointerId = -1;
  private _dividerStartX = 0;
  private _dividerStartWidth = 0;
  private static nextDomId = 1;
  private readonly domIdPrefix = `cpk-thread-detail-${CpkThreadInspector.nextDomId++}`;

  static readonly COLLAPSE_THRESHOLD = 800;
  static readonly TAB_LIST: ReadonlyArray<{
    id: ThreadDetailsTab;
    label: string;
  }> = [
    { id: "timeline", label: "Messages" },
    { id: "raw-events", label: "AG-UI Events" },
    { id: "state", label: "State" },
  ];

  private static providerIds = new WeakMap<ThreadDebuggerProvider, number>();
  private static nextProviderId = 1;

  private static providerLoadKey(
    provider: ThreadDebuggerProvider | null,
  ): string {
    if (!provider) return "provider:none";
    let id = CpkThreadInspector.providerIds.get(provider);
    if (!id) {
      id = CpkThreadInspector.nextProviderId;
      CpkThreadInspector.nextProviderId += 1;
      CpkThreadInspector.providerIds.set(provider, id);
    }
    return [
      `provider:${id}`,
      provider.getThreadMetadata ? "metadata:1" : "metadata:0",
      provider.getMessages ? "messages:1" : "messages:0",
      provider.getEvents ? "events:1" : "events:0",
      provider.getState ? "state:1" : "state:0",
    ].join("|");
  }

  /**
   * Build a deterministic signature for runtime fetch headers so auth/CSRF
   * changes invalidate cached thread data even when the selected thread is
   * otherwise unchanged.
   */
  private static headersLoadKey(headers: Record<string, string>): string {
    return JSON.stringify(
      Object.entries(headers).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey),
      ),
    );
  }

  private renderTabContent(id: ThreadDetailsTab): TemplateResult {
    if (id === "timeline") return this.renderTimeline();
    if (id === "state") return this.renderState();
    return this.renderEvents();
  }

  /** Returns the stable DOM ID for one tab in this inspector instance. */
  private tabDomId(id: ThreadDetailsTab): string {
    return `${this.domIdPrefix}-tab-${id}`;
  }

  /** Returns the stable DOM ID for the panel controlled by one tab. */
  private panelDomId(id: ThreadDetailsTab): string {
    return `${this.domIdPrefix}-panel-${id}`;
  }

  /** Selects and focuses the tab targeted by an ARIA tabs navigation key. */
  private handleTabKeyDown(
    event: KeyboardEvent,
    currentId: ThreadDetailsTab,
  ): void {
    const currentIndex = CpkThreadInspector.TAB_LIST.findIndex(
      (tab) => tab.id === currentId,
    );
    if (currentIndex < 0) return;

    let targetIndex: number | null = null;
    if (event.key === "ArrowRight") {
      targetIndex = (currentIndex + 1) % CpkThreadInspector.TAB_LIST.length;
    } else if (event.key === "ArrowLeft") {
      targetIndex =
        (currentIndex - 1 + CpkThreadInspector.TAB_LIST.length) %
        CpkThreadInspector.TAB_LIST.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = CpkThreadInspector.TAB_LIST.length - 1;
    }
    if (targetIndex === null) return;

    const target = CpkThreadInspector.TAB_LIST[targetIndex];
    if (!target) return;
    event.preventDefault();
    this.activateTab(target.id);
    this.shadowRoot
      ?.querySelector<HTMLButtonElement>(`#${this.tabDomId(target.id)}`)
      ?.focus();
  }

  private activateTab(id: ThreadDetailsTab): void {
    if (this._tab === id) return;
    const isFirstActivation = !this._activatedTabs.has(id);
    this._tab = id;
    if (isFirstActivation) {
      // First time opening this tab: paint a "Loading…" overlay for one
      // frame so the tab highlight + spinner appear before the heavy
      // per-tab render runs (events list, state JSON). The rAF batches
      // mounting the panel into `_activatedTabs` and clearing the spinner
      // into a single subsequent paint. Subsequent activations are pure
      // CSS toggles via display:none on the already-mounted panel — no
      // re-render required.
      this._panelInitializing = true;
      requestAnimationFrame(() => {
        this._activatedTabs = new Set([...this._activatedTabs, id]);
        this._panelInitializing = false;
      });
    }
    this.maybeFetchTabData(id);
  }

  selectTab(id: ThreadDetailsTab): void {
    this.activateTab(id);
  }

  private maybeFetchTabData(id: ThreadDetailsTab): void {
    // Lazy-trigger the events / state fetches so their (potentially huge)
    // JSON.parse only blocks the main thread after the user has shown
    // intent to view that sub-tab. Without lazy-load, the eager fetch runs
    // as soon as the thread opens and a single large response can stall
    // the entire panel for seconds — including making the tab buttons
    // themselves feel unresponsive.
    if (!this.threadId) return;
    if ((id === "timeline" || id === "raw-events") && !this._eventsFetched) {
      this._eventsFetched = true;
      void this.fetchEvents(this.threadId);
    } else if (id === "state" && !this._stateFetched) {
      this._stateFetched = true;
      void this.fetchState(this.threadId);
    }
  }

  static styles = css`
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

    /* ── Root ────────────────────────────────────────────────────────── */
    :host {
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }

    .cpk-td {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: row;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
    }

    /* ── Left area ───────────────────────────────────────────────────── */
    .cpk-td__left {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Tab bar header ──────────────────────────────────────────────── */
    .cpk-td__tabs-header {
      /* No top/right padding so tabs and toggle sit flush against the
         top and right edges of the inspector. */
      padding: 0 0 0 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
      display: flex;
      align-items: stretch;
    }

    .cpk-td__tab-group {
      display: flex;
      gap: 0;
      margin-bottom: -1px;
      /* Allow the tab list to shrink rather than pushing the panel-toggle
         button past the right edge of the inspector when horizontal space
         gets tight (the drawer being open eats noticeably into width). */
      min-width: 0;
      flex-shrink: 1;
      overflow: hidden;
    }

    .cpk-td__tab {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 11px;
      font-weight: 500;
      padding: 10px 12px;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      background: transparent;
      color: #68686e;
      transition:
        color 0.12s,
        border-color 0.12s;
      white-space: nowrap;
    }

    .cpk-td__tab:hover {
      color: #010507;
    }

    .cpk-td__tab:focus-visible {
      outline: 2px solid #5558b2;
      outline-offset: -3px;
      border-radius: 5px;
    }

    .cpk-td__tab--active {
      color: #010507;
      border-bottom-color: #bec2ff;
    }

    /* Toggle is a separate control, not a tab — so it does NOT use the
       tabs' bottom-border active indicator. Instead, a subtle filled
       state communicates "the drawer is open," and a vertical separator
       on the left visually divorces it from the tab group. */
    .cpk-td__panel-toggle {
      margin-left: auto;
      align-self: stretch;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 12px;
      border: none;
      border-left: 1px solid #dbdbe5;
      background: transparent;
      color: #68686e;
      cursor: pointer;
      flex-shrink: 0;
      transition:
        color 0.12s,
        background 0.12s;
    }
    .cpk-td__panel-toggle:hover {
      color: #010507;
      background: #f4f4f9;
    }
    .cpk-td__panel-toggle--active {
      color: #5558b2;
      background: #eee6fe;
    }
    .cpk-td__panel-toggle--active:hover {
      background: #e4d8fc;
    }

    /* ── Scrollable content ──────────────────────────────────────────── */
    .cpk-td__content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Pin direct children so expanded tool bodies don't get flex-shrunk. */
    .cpk-td__content > * {
      flex-shrink: 0;
    }

    .cpk-td__metadata-strip {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      padding: 10px 16px;
      border-bottom: 1px solid #e9e9ef;
      background: #fbfbfd;
      flex-shrink: 0;
    }

    .cpk-td__metadata-pills {
      display: flex;
      gap: 6px;
      flex: 1;
      flex-wrap: wrap;
      min-width: 0;
    }

    .cpk-td__metadata-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 220px;
      padding: 3px 7px;
      border: 1px solid #e9e9ef;
      border-radius: 6px;
      background: #ffffff;
      color: #57575b;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      white-space: nowrap;
    }

    .cpk-td__metadata-label {
      color: #68686e;
      text-transform: uppercase;
      font-size: 9px;
    }

    .cpk-td__metadata-value {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cpk-td__metadata-pill--wrap {
      max-width: 100%;
      white-space: normal;
    }

    .cpk-td__metadata-value--wrap {
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .cpk-td__view-in-app {
      appearance: none;
      flex-shrink: 0;
      margin: 0;
      border: 1px solid #5558b2;
      border-radius: 6px;
      background: #5558b2;
      color: #ffffff;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 10px;
      cursor: pointer;
    }

    .cpk-td__view-in-app:focus-visible {
      outline: 2px solid #010507;
      outline-offset: 2px;
    }

    .cpk-td__view-in-app--stop {
      background: #ffffff;
      color: #5558b2;
    }

    .cpk-td__view-in-app-error {
      flex-basis: 100%;
      color: #c0333a;
      font-size: 11px;
    }

    /*
     * Each tab's content is wrapped in this panel so the keep-mounted
     * inactive panels can be hidden via display:none without disturbing
     * the gap between visible siblings. The flex column + gap gives each
     * conversation item / event row breathing room (the cpk-td__content
     * rule above no longer reaches them now that they are nested inside
     * the per-panel wrapper).
     */
    .cpk-td__panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .cpk-td__panel > * {
      flex-shrink: 0;
    }

    .cpk-td__panel[hidden] {
      display: none;
    }

    /* ── Empty state ─────────────────────────────────────────────────── */
    .cpk-td__empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #68686e;
      font-size: 13px;
      padding: 40px 0;
    }

    .cpk-td__empty-hint {
      font-size: 11px;
      color: #68686e;
      text-align: center;
      max-width: 220px;
      line-height: 1.5;
    }

    /* ── Status messages ─────────────────────────────────────────────── */
    .cpk-td__status {
      padding: 16px;
      font-size: 12px;
      color: #68686e;
      text-align: center;
    }

    .cpk-td__status--error {
      color: #c0333a;
    }

    @keyframes cpk-td-focus-pulse {
      0% {
        outline-color: rgba(100, 48, 171, 0);
        box-shadow: 0 0 0 rgba(100, 48, 171, 0);
        animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
      }
      24%,
      50% {
        outline-color: rgba(100, 48, 171, 0.78);
        box-shadow: 0 7px 20px rgba(100, 48, 171, 0.2);
      }
      100% {
        outline-color: rgba(100, 48, 171, 0);
        box-shadow: 0 0 0 rgba(100, 48, 171, 0);
      }
    }

    .cpk-td__focus-pulse {
      position: relative;
      z-index: 1;
      outline: 2px solid transparent;
      outline-offset: 3px;
      animation: cpk-td-focus-pulse 760ms linear;
    }

    @media (prefers-reduced-motion: reduce) {
      .cpk-td__focus-pulse {
        animation-duration: 320ms;
      }
    }

    /* ── Conversation bubbles ────────────────────────────────────────── */
    .cpk-td__bubble {
      display: flex;
      margin-bottom: 2px;
    }

    .cpk-td__bubble--user {
      justify-content: flex-end;
    }

    .cpk-td__bubble--assistant {
      justify-content: flex-start;
    }

    .cpk-td__bubble-inner {
      padding: 9px 14px;
      max-width: 75%;
      font-size: 13px;
      line-height: 1.55;
    }

    .cpk-td__bubble-inner--user {
      background: #eee6fe;
      color: #57575b;
      border-radius: 12px 12px 4px 12px;
    }

    .cpk-td__show-more {
      display: inline-block;
      margin-top: 4px;
      font-size: 11px;
      font-weight: 500;
      color: #57575b;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .cpk-td__bubble-inner--assistant {
      background: #f7f7f9;
      color: #010507;
      border-radius: 12px 12px 12px 4px;
      border: 1px solid #e9e9ef;
    }

    /* ── Tool call blocks ────────────────────────────────────────────── */
    .cpk-td__tool-block {
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      overflow: hidden;
    }

    .cpk-td__tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(133, 236, 206, 0.15);
      cursor: pointer;
      font-size: 11px;
      user-select: none;
    }

    .cpk-td__tool-header:hover {
      background: rgba(133, 236, 206, 0.22);
    }

    .cpk-td__tool-name {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      font-weight: 500;
      color: #087653;
      text-transform: uppercase;
      flex: 1;
    }

    .cpk-td__tool-status {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-transform: uppercase;
      color: #087653;
    }

    .cpk-td__tool-status--pending {
      color: #8a5900;
    }

    .cpk-td__tool-chevron {
      color: #68686e;
      font-size: 10px;
    }

    .cpk-td__tool-body {
      padding: 8px 10px;
      border-top: 1px solid #e9e9ef;
      background: #ffffff;
    }

    .cpk-td__tool-section-label {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 500;
      color: #68686e;
      text-transform: uppercase;
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }

    .cpk-td__tool-pre {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      background: #f7f7f9;
      padding: 6px 8px;
      border-radius: 5px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #010507;
      line-height: 1.6;
    }

    /* ── Tool call group ─────────────────────────────────────────────── */
    .cpk-td__tool-group {
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      overflow: hidden;
    }

    .cpk-td__tool-group-header {
      padding: 5px 10px;
      background: rgba(133, 236, 206, 0.15);
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      color: #087653;
      text-transform: uppercase;
      font-weight: 500;
      border-bottom: 1px solid #e9e9ef;
    }

    .cpk-td__tool-group .cpk-td__tool-block {
      border: none;
      border-bottom: 1px solid #e9e9ef;
      border-radius: 0;
    }

    .cpk-td__tool-group .cpk-td__tool-block:last-child {
      border-bottom: none;
    }

    /* ── Inline chips (reasoning / state update) ─────────────────────── */
    .cpk-td__inline-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      color: #68686e;
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-transform: uppercase;
    }

    .cpk-td__inline-chip::before,
    .cpk-td__inline-chip::after {
      content: "";
      flex: 1;
      height: 1px;
      background: #e9e9ef;
    }

    /* ── Interaction timeline ───────────────────────────────────────── */
    .cpk-td__timeline-item {
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      background: #ffffff;
      overflow: hidden;
    }

    .cpk-td__timeline-item--warning {
      border-color: rgba(250, 95, 103, 0.35);
      background: rgba(250, 95, 103, 0.04);
    }

    .cpk-td__timeline-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      background: #f7f7f9;
    }

    .cpk-td__timeline-kind {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      color: #5558b2;
    }

    .cpk-td__timeline-title {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      font-weight: 500;
      color: #010507;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cpk-td__timeline-time {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      color: #68686e;
      flex-shrink: 0;
    }

    .cpk-td__timeline-body {
      margin: 0;
      padding: 0 10px 9px;
      font-size: 12px;
      line-height: 1.55;
      color: #57575b;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .cpk-td__timeline-toolbar {
      display: flex;
      gap: 6px;
      margin-left: auto;
    }

    .cpk-td__timeline-bulk-toggle {
      margin: 0;
      padding: 4px 8px;
      border: 1px solid #dcdce8;
      border-radius: 7px;
      background: #ffffff;
      color: #36363a;
      cursor: pointer;
      font-family: "Inter", sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.2;
    }

    .cpk-td__timeline-bulk-toggle:hover {
      border-color: rgba(85, 88, 178, 0.38);
      background: #f7f7ff;
      color: #010507;
    }

    .cpk-td__timeline-bulk-toggle:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .cpk-td__source-link {
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      color: #5558b2;
      cursor: pointer;
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-decoration: underline;
      text-underline-offset: 2px;
      flex-shrink: 0;
    }

    .cpk-td__source-link:hover {
      color: #010507;
    }

    .cpk-td__timeline-details-toggle {
      margin: 0;
      padding: 5px 10px;
      border: none;
      background: #ffffff;
      color: #5558b2;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: "Inter", sans-serif;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
      width: 100%;
    }

    .cpk-td__timeline-details-toggle:hover {
      background: #f7f7ff;
      color: #010507;
    }

    .cpk-td__timeline-details-toggle svg {
      width: 12px;
      height: 12px;
      stroke-width: 2;
    }

    /* ── Generative UI ──────────────────────────────────────────────── */
    @keyframes cpk-genui-enter {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes cpk-playground-message-enter {
      from {
        opacity: 0;
        filter: blur(2px);
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
      }
    }

    @keyframes cpk-playground-thinking {
      0%,
      60%,
      100% {
        opacity: 0.28;
        transform: translateY(0);
      }
      30% {
        opacity: 1;
        transform: translateY(-2px);
      }
    }

    .cpk-playground-root {
      container-type: inline-size;
    }

    .cpk-playground-message-enter {
      animation: cpk-playground-message-enter 0.24s cubic-bezier(0.16, 1, 0.3, 1)
        both;
    }

    .cpk-playground-thinking-dot {
      animation: cpk-playground-thinking 1.2s ease-in-out infinite;
    }

    .cpk-playground-thinking-dot:nth-child(2) {
      animation-delay: 0.12s;
    }

    .cpk-playground-thinking-dot:nth-child(3) {
      animation-delay: 0.24s;
    }

    .cpk-playground-reasoning summary::-webkit-details-marker {
      display: none;
    }

    .cpk-playground-reasoning[open] .cpk-playground-reasoning-chevron {
      transform: rotate(90deg);
    }

    @container (max-width: 560px) {
      .cpk-playground-header {
        align-items: stretch;
      }

      .cpk-playground-actions {
        width: 100%;
      }

      .cpk-playground-thread-select {
        min-width: 0;
        max-width: none;
        flex: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .cpk-playground-message-enter,
      .cpk-playground-thinking-dot {
        animation: none;
      }
    }

    .cpk-td__genui {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 16px 8px;
      animation: cpk-genui-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .cpk-td__genui-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 5px;
      background: #eee6fe;
      color: #57575b;
      font-size: 10px;
      font-weight: 600;
      align-self: flex-start;
    }

    .cpk-td__genui-card {
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      background: #fff;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
    }

    .cpk-td__genui-placeholder {
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid #ede9fe;
      background: #f5f3ff;
      color: #7c3aed;
      font-size: 11px;
    }

    /* ── AG-UI Events ────────────────────────────────────────────────── */
    .cpk-td__event {
      flex-shrink: 0;
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      overflow: hidden;
      /*
       * content-visibility: auto lets the browser skip layout + paint for
       * off-screen events while keeping them in the DOM (so scroll size
       * stays correct). Without this, switching back to AG-UI Events on a
       * thread with hundreds of events triggers a full layout pass over
       * every event row, which on Martha's intelligence-backed example
       * shows up as a multi-second freeze each time the panel becomes
       * visible. The intrinsic-size hint avoids the visible jump as the
       * browser swaps in real heights when items scroll into view.
       */
      content-visibility: auto;
      contain-intrinsic-size: 0 80px;
    }

    .cpk-td__event-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 10px;
    }

    .cpk-td__event-type {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .cpk-td__event-time {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      color: #68686e;
    }

    .cpk-td__event-payload {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: #57575b;
      padding: 8px 10px;
      border-top: 1px solid #e9e9ef;
    }

    /* ── JSON block (agent state) ────────────────────────────────────── */
    .cpk-td__json-block,
    .cpk-json-block {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 11px;
      line-height: 1.8;
      white-space: pre-wrap;
      word-break: break-all;
      color: #57575b;
    }

    /* ── Resize divider ──────────────────────────────────────────────── */
    /* Floats over the drawer's left edge so the toggle and the drawer
       touch directly without a 4px flex-gap between them. The hit zone
       is wider than its visual hint to make it easy to grab. */
    .cpk-td__detail-divider {
      position: absolute;
      top: 0;
      bottom: 0;
      left: -3px;
      width: 7px;
      cursor: col-resize;
      background: transparent;
      z-index: 5;
    }

    .cpk-td__detail-divider:hover {
      background: rgba(190, 194, 255, 0.3);
    }

    /* ── Right detail panel ──────────────────────────────────────────── */
    .cpk-td__detail {
      flex-shrink: 0;
      overflow: hidden;
      background: #f7f7f9;
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
      box-sizing: border-box;
      position: relative;
      /* Slide open/closed via width + padding transition. When closed,
         width and padding are 0 so the drawer fully collapses. */
      transition:
        width 220ms cubic-bezier(0.4, 0, 0.2, 1),
        padding 220ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .cpk-td__detail[data-open="true"] {
      overflow-y: auto;
      padding: 16px;
    }

    .cpk-tdp__section-title {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      font-weight: 500;
      color: #68686e;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 8px;
    }

    .cpk-tdp__divider {
      height: 1px;
      background: #dbdbe5;
      margin: 14px 0;
    }

    .cpk-tdp__row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 3px 0;
      gap: 8px;
    }

    .cpk-tdp__label {
      color: #68686e;
      font-size: 11px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .cpk-tdp__value {
      color: #010507;
      font-family: "Spline Sans Mono", monospace;
      font-size: 11px;
      text-align: right;
      min-width: 0;
    }

    .cpk-tdp__value--truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 130px;
    }

    .cpk-tdp__value--wrap {
      white-space: normal;
      word-break: break-all;
      text-align: right;
    }

    :host([data-color-scheme="dark"]) {
      color-scheme: dark;
    }

    :host([data-color-scheme="dark"]) .cpk-td {
      background: #111319;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-td__tabs-header,
    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-strip,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-pill,
    :host([data-color-scheme="dark"]) .cpk-td__tool-block,
    :host([data-color-scheme="dark"]) .cpk-td__tool-header,
    :host([data-color-scheme="dark"]) .cpk-td__tool-body,
    :host([data-color-scheme="dark"]) .cpk-td__event,
    :host([data-color-scheme="dark"]) .cpk-td__event-payload,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-item,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle {
      border-color: #343742;
    }

    :host([data-color-scheme="dark"]) .cpk-td__metadata-strip,
    :host([data-color-scheme="dark"]) .cpk-td__detail {
      background: #15171e;
    }

    :host([data-color-scheme="dark"]) .cpk-td__metadata-pill,
    :host([data-color-scheme="dark"]) .cpk-td__bubble-inner--assistant,
    :host([data-color-scheme="dark"]) .cpk-td__tool-block,
    :host([data-color-scheme="dark"]) .cpk-td__event,
    :host([data-color-scheme="dark"]) .cpk-td__genui-card,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-item,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle {
      border-color: #343742;
      background: #191c24;
    }

    :host([data-color-scheme="dark"]) .cpk-td__timeline-header,
    :host([data-color-scheme="dark"]) .cpk-td__tool-body,
    :host([data-color-scheme="dark"]) .cpk-td__tool-pre {
      background: #171a22;
    }

    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle:hover,
    :host([data-color-scheme="dark"]) .cpk-td__tool-header:hover,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle:hover,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle:hover {
      background: #20232d;
    }

    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle--active,
    :host([data-color-scheme="dark"]) .cpk-td__inline-chip,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-kind,
    :host([data-color-scheme="dark"]) .cpk-td__genui-badge {
      background: #302b43;
      color: #d8d9ff;
    }

    :host([data-color-scheme="dark"]) .cpk-td__tab,
    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-label,
    :host([data-color-scheme="dark"]) .cpk-td__event-time,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-time,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-body,
    :host([data-color-scheme="dark"]) .cpk-tdp__label,
    :host([data-color-scheme="dark"]) .cpk-tdp__section-title {
      color: #aeb1bd;
    }

    :host([data-color-scheme="dark"]) .cpk-td__tab:hover,
    :host([data-color-scheme="dark"]) .cpk-td__tab--active,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-value,
    :host([data-color-scheme="dark"]) .cpk-td__tool-name,
    :host([data-color-scheme="dark"]) .cpk-td__tool-pre,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-title,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle,
    :host([data-color-scheme="dark"]) .cpk-tdp__value {
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-td__event-payload,
    :host([data-color-scheme="dark"]) .cpk-td__json-block,
    :host([data-color-scheme="dark"]) .cpk-json-block {
      color: #c7c9d2;
    }

    :host([data-color-scheme="dark"]) .cpk-tdp__divider {
      background: #343742;
    }
  `;

  updated(_changed: Map<string, unknown>): void {
    if (!this.isConnected) return;
    const loadKey = this.currentLoadKey();
    if (loadKey !== this._lastLoadKey) {
      this._lastLoadKey = loadKey;
      this._lastSeenLiveMessageVersion = this.liveMessageVersion;
      this.resetLoadedThreadData();

      if (this.threadId) {
        // Timeline is the default tab and should be event-derived. Fetch
        // events eagerly; the raw tab reuses the same response when opened.
        void this.fetchMetadata(this.threadId);
        if (this.canFetchEvents()) {
          this._eventsFetched = true;
          void this.fetchEvents(this.threadId);
        } else {
          // Last-resort compatibility path for consumers that only implement
          // messages. New integrations should provide events so Timeline can
          // expose source references and decode warnings.
          void this.fetchMessages(this.threadId);
        }
      } else {
        this._fetchedMetadata = null;
        this._conversation = [];
      }
    } else if (
      this.threadId &&
      this.liveMessageVersion !== this._lastSeenLiveMessageVersion
    ) {
      // Same thread, but the parent inspector signalled new agent-emitted
      // messages on this thread (via `liveMessageVersion`). Re-fetch the
      // canonical conversation from the runtime so streaming output flows
      // into the view without us reimplementing AG-UI → ConversationItem
      // mapping in the parent. `silent: true` so the loading-state indicator
      // doesn't flash between every streaming chunk and we keep the
      // last-good view on transient fetch errors.
      this._lastSeenLiveMessageVersion = this.liveMessageVersion;
      this._messagesAbort?.abort();
      this._messagesAbort = null;
      void this.fetchMessages(this.threadId, true);
    }

    const focusedContentChanged =
      _changed.has("_fetchedEvents") ||
      _changed.has("agentEventsInput") ||
      _changed.has("_conversation");
    if (
      this.focusMessageId &&
      (this.focusRequestId > this._scrolledFocusRequestId ||
        focusedContentChanged)
    ) {
      if (this._tab !== "timeline") {
        this._activatedTabs = new Set([...this._activatedTabs, "timeline"]);
        this._tab = "timeline";
        this.requestUpdate();
      }
      requestAnimationFrame(() => this.scrollToFocusedMessage());
    }
  }

  private scrollToFocusedMessage(): void {
    if (!this.focusMessageId) return;
    const message = Array.from(
      this.shadowRoot?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((candidate) => candidate.dataset.messageId === this.focusMessageId);
    if (!message) return;
    message.scrollIntoView?.({ block: "center" });
    this._scrolledFocusRequestId = this.focusRequestId;
    this.pulseFocusedMessage(message);
  }

  private pulseFocusedMessage(message: HTMLElement): void {
    if (this.focusRequestId === this._highlightedFocusRequestId) return;
    this._highlightedFocusRequestId = this.focusRequestId;
    message.classList.remove("cpk-td__focus-pulse");
    void message.offsetWidth;
    message.classList.add("cpk-td__focus-pulse");
    message.addEventListener(
      "animationend",
      () => message.classList.remove("cpk-td__focus-pulse"),
      { once: true },
    );
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this._hasConnectedOnce) {
      this.requestUpdate();
    }
    this._hasConnectedOnce = true;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resetLoadedThreadData();
    this._lastLoadKey = null;
  }

  private canFetchMessages(): boolean {
    return (
      !!this.provider?.getMessages ||
      (!!this.runtimeUrl && this.threadInspectionAvailable)
    );
  }

  private canFetchEvents(): boolean {
    return (
      !!this.provider?.getEvents ||
      (!!this.runtimeUrl && this.threadInspectionAvailable)
    );
  }

  private canFetchState(): boolean {
    return (
      !!this.provider?.getState ||
      (!!this.runtimeUrl && this.threadInspectionAvailable)
    );
  }

  private currentLoadKey(): string {
    return [
      this.threadId ?? "thread:none",
      CpkThreadInspector.providerLoadKey(this.provider),
      `runtime:${this.runtimeUrl}`,
      `headers:${CpkThreadInspector.headersLoadKey(this.headers)}`,
      `inspect:${this.threadInspectionAvailable ? "1" : "0"}`,
    ].join("||");
  }

  private resetLoadedThreadData(): void {
    this._tab = "timeline";
    this._activatedTabs = new Set(["timeline"]);
    this._panelTplCache = new Map();
    this._timelineItemsCache = null;
    this._liveEventsWithSourceIndexCache = null;
    this._expandedTools = new Set();
    this._expandedMessages = new Set();
    this._expandedTimelineDetails = new Set();
    this._expandedRawEvents = new Set();
    this._metadataAbort?.abort();
    this._metadataAbort = null;
    this._messagesAbort?.abort();
    this._messagesAbort = null;
    this._eventsAbort?.abort();
    this._eventsAbort = null;
    this._stateAbort?.abort();
    this._stateAbort = null;
    // Reset cleared so the next click into events/state triggers a fresh
    // fetch. Eagerly clear fetched data so a provider/runtime swap cannot
    // briefly show the old source's values for the same threadId.
    this._eventsFetched = false;
    this._stateFetched = false;
    this._eventsNotAvailable = false;
    this._stateNotAvailable = false;
    this._loadingMessages = false;
    this._loadingEvents = false;
    this._loadingState = false;
    this._messagesError = null;
    this._eventsError = null;
    this._stateError = null;
    this._fetchedMetadata = null;
    this._conversation = [];
    this._fetchedEvents = null;
    this._fetchedState = null;
  }

  private async fetchMetadata(threadId: string): Promise<void> {
    if (!this.provider?.getThreadMetadata) return;
    this._metadataAbort?.abort();
    const controller = new AbortController();
    this._metadataAbort = controller;
    try {
      const metadata = await this.provider.getThreadMetadata(threadId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || this.threadId !== threadId) return;
      this._fetchedMetadata = metadata;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (this.threadId !== threadId) return;
      this._fetchedMetadata = null;
    }
  }

  /**
   * Fetch the canonical conversation for `threadId` from the runtime.
   *
   * `silent` is true for live re-fetches triggered by `liveMessageVersion`
   * bumps during streaming. In that mode we never toggle the loading state
   * (which would flash "Loading messages…" between every message) and we
   * keep the previous conversation on transient errors instead of blanking
   * it. Initial threadId-change fetches use the default (`silent=false`)
   * so users see an explicit loading indicator on first load.
   */
  private async fetchMessages(
    threadId: string,
    silent: boolean = false,
  ): Promise<void> {
    if (!this.canFetchMessages()) {
      if (!silent) this._conversation = [];
      return;
    }
    this._messagesAbort?.abort();
    const controller = new AbortController();
    this._messagesAbort = controller;
    if (!silent) {
      this._loadingMessages = true;
      this._messagesError = null;
    }
    try {
      const messages = this.provider?.getMessages
        ? await this.provider.getMessages(threadId, {
            signal: controller.signal,
          })
        : await this.fetchRuntimeMessages(threadId, controller.signal);
      if (controller.signal.aborted || this.threadId !== threadId) return;
      this._conversation = this.mapMessages(messages);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!silent) {
        this._messagesError =
          err instanceof Error ? err.message : "Failed to load messages";
        this._conversation = [];
      }
      // Silent mode: keep last-good conversation, don't surface the error.
      // The next successful live re-fetch will recover automatically.
    } finally {
      if (!silent && !controller.signal.aborted) {
        this._loadingMessages = false;
      }
    }
  }

  private async fetchEvents(threadId: string): Promise<void> {
    if (!this.canFetchEvents()) {
      this._fetchedEvents = null;
      return;
    }
    this._eventsAbort?.abort();
    const controller = new AbortController();
    this._eventsAbort = controller;
    this._loadingEvents = true;
    this._eventsError = null;
    try {
      const result = this.provider?.getEvents
        ? {
            status: "available" as const,
            events: await this.provider.getEvents(threadId, {
              signal: controller.signal,
            }),
          }
        : await this.fetchRuntimeEvents(threadId, controller.signal);
      // Drop results if a newer fetch superseded this one (thread switched
      // or provider/runtime changed mid-flight). Without this, switching A→B
      // can leave thread B's view showing thread A's events when A's request
      // resolves last.
      if (controller.signal.aborted || this.threadId !== threadId) return;
      if (result.status === "not-available") {
        this._eventsNotAvailable = true;
        this._fetchedEvents = [];
        if (this.canFetchMessages()) {
          void this.fetchMessages(threadId);
        }
        return;
      }
      const mappedEvents = this.mapApiEvents(result.events);
      this._fetchedEvents = mappedEvents;
      if (mappedEvents.length === 0 && this.canFetchMessages()) {
        void this.fetchMessages(threadId);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (this.threadId !== threadId) return;
      this._eventsError =
        err instanceof Error ? err.message : "Failed to load events";
      this._fetchedEvents = [];
      if (this.canFetchMessages()) {
        void this.fetchMessages(threadId);
      }
    } finally {
      if (!controller.signal.aborted && this.threadId === threadId) {
        this._loadingEvents = false;
      }
    }
  }

  private async fetchState(threadId: string): Promise<void> {
    if (!this.canFetchState()) {
      this._fetchedState = null;
      return;
    }
    this._stateAbort?.abort();
    const controller = new AbortController();
    this._stateAbort = controller;
    this._loadingState = true;
    this._stateError = null;
    try {
      const result = this.provider?.getState
        ? {
            status: "available" as const,
            state: await this.provider.getState(threadId, {
              signal: controller.signal,
            }),
          }
        : await this.fetchRuntimeState(threadId, controller.signal);
      if (controller.signal.aborted || this.threadId !== threadId) return;
      if (result.status === "not-available") {
        this._stateNotAvailable = true;
        this._fetchedState = null;
        return;
      }
      this._fetchedState = result.state ?? null;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (this.threadId !== threadId) return;
      this._stateError =
        err instanceof Error ? err.message : "Failed to load state";
      this._fetchedState = null;
    } finally {
      if (!controller.signal.aborted && this.threadId === threadId) {
        this._loadingState = false;
      }
    }
  }

  private async fetchRuntimeMessages(
    threadId: string,
    signal: AbortSignal,
  ): Promise<ThreadDebuggerMessage[]> {
    const res = await fetch(this.getThreadInspectionUrl(threadId, "messages"), {
      headers: { ...this.headers },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { messages: ThreadDebuggerMessage[] };
    return data.messages;
  }

  private async fetchRuntimeEvents(
    threadId: string,
    signal: AbortSignal,
  ): Promise<RuntimeEventsFetchResult> {
    const res = await fetch(this.getThreadInspectionUrl(threadId, "events"), {
      headers: { ...this.headers },
      signal,
    });
    if (res.status === 501) {
      return { status: "not-available" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      events: ThreadDebuggerEvent[];
    };
    return { status: "available", events: data.events };
  }

  private async fetchRuntimeState(
    threadId: string,
    signal: AbortSignal,
  ): Promise<RuntimeStateFetchResult> {
    const res = await fetch(this.getThreadInspectionUrl(threadId, "state"), {
      headers: { ...this.headers },
      signal,
    });
    if (res.status === 501) {
      return { status: "not-available" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      state: Record<string, unknown> | null;
    };
    return { status: "available", state: data.state ?? null };
  }

  private getThreadInspectionUrl(
    threadId: string,
    resource: "messages" | "events" | "state",
  ): string {
    return `${this.runtimeUrl.replace(/\/+$/, "")}/threads/${encodeURIComponent(threadId)}/${resource}`;
  }

  private mapMessages(messages: ThreadDebuggerMessage[]): ConversationItem[] {
    const items: ConversationItem[] = [];
    const toolCallMap = new Map<string, ConversationToolCall>();
    for (const msg of messages) {
      if (msg.role === "user" && msg.content) {
        items.push({
          id: msg.id,
          type: "user",
          content: msg.content,
          createdAt: "",
        });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            let args: Record<string, unknown> = {};
            if (typeof tc.args === "string") {
              try {
                args = this.parseToolCallContent(tc.args);
              } catch (err) {
                // Empty content is normalized to `{}` for both tool arguments
                // and results. The inspector still surfaces malformed JSON.
                console.error(
                  "[CopilotKit Inspector] Failed to parse tool-call arguments",
                  { toolCallId: tc.id, raw: tc.args, error: err },
                );
                args = { __parseError: true, __raw: tc.args };
              }
            } else {
              args = tc.args;
            }
            const item: ConversationToolCall = {
              id: tc.id,
              type: "tool_call",
              toolName: tc.name,
              toolCallId: tc.id,
              arguments: args,
              result: null,
              createdAt: "",
            };
            toolCallMap.set(tc.id, item);
            items.push(item);
          }
        }
        if (msg.content) {
          items.push({
            id: msg.id,
            type: "assistant",
            content: msg.content,
            createdAt: "",
          });
        }
      } else if (msg.role === "activity") {
        items.push({
          id: msg.id,
          type: "generative-ui",
          activityType: msg.activityType ?? "unknown",
          createdAt: "",
        });
      } else if (msg.role === "tool" && msg.toolCallId) {
        const tc = toolCallMap.get(msg.toolCallId);
        if (tc) {
          try {
            tc.result = this.parseToolCallContent(msg.content);
          } catch (err) {
            // See the comment on the assistant tool-call args parse above —
            // same rationale, same sentinel shape so the renderer can treat
            // both consistently.
            console.error(
              "[CopilotKit Inspector] Failed to parse tool-call result content",
              { toolCallId: msg.toolCallId, raw: msg.content, error: err },
            );
            tc.result = { __parseError: true, __raw: msg.content ?? null };
          }
        }
      }
    }
    return items;
  }

  private parseToolCallContent(
    content: string | null | undefined,
  ): Record<string, unknown> {
    const normalizedContent = content?.trim();
    if (!normalizedContent) {
      return {};
    }

    return JSON.parse(normalizedContent) as Record<string, unknown>;
  }

  private mapApiEvents(events: ThreadDebuggerEvent[]): ApiAgentEvent[] {
    return events.map((event, index) => {
      const { type, timestamp, payload, ...rest } = event;
      return {
        type: typeof type === "string" ? type : "UNKNOWN",
        timestamp:
          typeof timestamp === "string" || typeof timestamp === "number"
            ? timestamp
            : Date.now(),
        payload: payload ?? rest,
        sourceIndex: index + 1,
        rawEvent: event,
      };
    });
  }

  private get activeTimelineItems(): TimelineItem[] {
    return this.timelineItemsForEvents(this.activeEvents);
  }

  private timelineItemsForEvents(events: ApiAgentEvent[]): TimelineItem[] {
    if (this._timelineItemsCache?.events === events) {
      return this._timelineItemsCache.items;
    }
    const items = this.timelineItemsFromEvents(events);
    this._timelineItemsCache = { events, items };
    return items;
  }

  private timelineItemsFromEvents(events: ApiAgentEvent[]): TimelineItem[] {
    if (events.length === 0) return [];

    const items: TimelineItem[] = [];
    const messageItems = new Map<string, TimelineItem>();
    const toolItems = new Map<string, TimelineItem & { rawArgs?: string }>();

    const readString = (
      payload: Record<string, unknown>,
      keys: string[],
    ): string | null => {
      for (const key of keys) {
        const value = payload[key];
        if (typeof value === "string") return value;
      }
      return null;
    };

    const sourceIndexFor = (event: ApiAgentEvent): number =>
      event.sourceIndex ?? 0;

    const appendWarning = (
      event: ApiAgentEvent,
      title: string,
      body: string,
      severity: "warning" | "error" = "warning",
    ): void => {
      const sourceIndex = sourceIndexFor(event);
      items.push({
        id: `warning-${sourceIndex}-${items.length}`,
        kind: "warning",
        title,
        body,
        timestamp: event.timestamp,
        sourceIndex,
        severity,
      });
    };

    const ensureMessage = (
      event: ApiAgentEvent,
      role: string,
    ): TimelineItem => {
      const sourceIndex = sourceIndexFor(event);
      const key =
        readString(event.payload, ["messageId", "message_id", "id"]) ??
        `message-${sourceIndex}`;
      let item = messageItems.get(key);
      if (!item) {
        item = {
          id: `message-${key}`,
          messageId: key,
          kind: "message",
          title: `${role || "message"} message`,
          body: "",
          timestamp: event.timestamp,
          sourceIndex,
        };
        messageItems.set(key, item);
        items.push(item);
      }
      return item;
    };

    const ensureTool = (
      event: ApiAgentEvent,
    ): TimelineItem & {
      rawArgs?: string;
    } => {
      const sourceIndex = sourceIndexFor(event);
      const key =
        readString(event.payload, [
          "toolCallId",
          "tool_call_id",
          "id",
          "callId",
        ]) ?? `tool-${sourceIndex}`;
      let item = toolItems.get(key);
      if (!item) {
        item = {
          id: `tool-${key}`,
          kind: "tool",
          title:
            readString(event.payload, [
              "toolCallName",
              "toolName",
              "name",
              "functionName",
            ]) ?? "Tool call",
          body: "",
          timestamp: event.timestamp,
          sourceIndex,
        };
        toolItems.set(key, item);
        items.push(item);
      }
      return item;
    };

    for (const event of events) {
      const { type, payload } = event;
      const sourceIndex = sourceIndexFor(event);

      if (type === "UNKNOWN") {
        appendWarning(
          event,
          "Unknown AG-UI event",
          "The event is missing a string type and could not be normalized.",
        );
        continue;
      }

      if (type === "RUN_STARTED" || type === "STEP_STARTED") {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "run",
          title: type === "RUN_STARTED" ? "Run started" : "Step started",
          timestamp: event.timestamp,
          sourceIndex,
          details: payload,
        });
        continue;
      }

      if (type === "RUN_FINISHED" || type === "STEP_FINISHED") {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "run",
          title: type === "RUN_FINISHED" ? "Run finished" : "Step finished",
          timestamp: event.timestamp,
          sourceIndex,
          details: payload,
        });
        continue;
      }

      if (type === "RUN_ERROR" || type === "ERROR") {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "warning",
          title: "Run error",
          body: readString(payload, ["message", "error", "description"]) ?? "",
          timestamp: event.timestamp,
          sourceIndex,
          severity: "error",
          details: payload,
        });
        continue;
      }

      if (type === "TEXT_MESSAGE_START") {
        ensureMessage(event, readString(payload, ["role"]) ?? "assistant");
        continue;
      }

      if (type === "TEXT_MESSAGE_CONTENT") {
        const item = ensureMessage(
          event,
          readString(payload, ["role"]) ?? "assistant",
        );
        item.body = `${item.body ?? ""}${
          readString(payload, ["delta", "content", "text"]) ?? ""
        }`;
        continue;
      }

      if (type === "TEXT_MESSAGE_END") {
        ensureMessage(event, readString(payload, ["role"]) ?? "assistant");
        continue;
      }

      if (type === "TOOL_CALL_START") {
        ensureTool(event);
        continue;
      }

      if (type === "TOOL_CALL_ARGS") {
        const item = ensureTool(event);
        const chunk =
          readString(payload, ["args", "arguments", "delta"]) ??
          (typeof payload.args === "object"
            ? JSON.stringify(payload.args)
            : null);
        if (chunk) {
          item.rawArgs = `${item.rawArgs ?? ""}${chunk}`;
          item.body = item.rawArgs;
        }
        continue;
      }

      if (type === "TOOL_CALL_END") {
        const item = ensureTool(event);
        if (item.rawArgs) {
          try {
            JSON.parse(item.rawArgs);
          } catch {
            appendWarning(
              event,
              "Could not decode tool call arguments",
              item.rawArgs,
            );
          }
        }
        continue;
      }

      if (type === "TOOL_CALL_RESULT") {
        const item = ensureTool(event);
        const result = readString(payload, ["result", "content", "delta"]);
        if (result) {
          item.body = item.body
            ? `${item.body}\nResult: ${result}`
            : `Result: ${result}`;
          try {
            JSON.parse(result);
          } catch {
            appendWarning(event, "Could not decode tool result", result);
          }
        }
        continue;
      }

      if (type.startsWith("STATE_")) {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "state",
          title:
            type === "STATE_SNAPSHOT"
              ? "State snapshot captured"
              : "State delta captured",
          timestamp: event.timestamp,
          sourceIndex,
          details: payload,
        });
        continue;
      }

      items.push({
        id: `event-${sourceIndex}`,
        kind: "event",
        title: type,
        timestamp: event.timestamp,
        sourceIndex,
        details: payload,
      });
    }

    return items;
  }

  private get renderItems(): RenderItem[] {
    const items = this._conversation;
    const result: RenderItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item.type === "agent_responded") continue;
      if (item.type !== "tool_call" || !item.groupId) {
        result.push(item);
        continue;
      }
      if (seen.has(item.groupId)) continue;
      seen.add(item.groupId);
      const group: ToolCallGroup = {
        type: "tool_call_group",
        id: item.groupId,
        items: items.filter(
          (i): i is ConversationToolCall =>
            i.type === "tool_call" && i.groupId === item.groupId,
        ),
      };
      result.push(group);
    }
    return result;
  }

  private get activityCounts(): {
    messages: number;
    toolCalls: number;
    generativeUi: number;
  } {
    let messages = 0;
    let toolCalls = 0;
    let generativeUi = 0;
    for (const item of this._conversation) {
      if (item.type === "user" || item.type === "assistant") messages++;
      if (item.type === "tool_call") toolCalls++;
      if (item.type === "generative-ui") generativeUi++;
    }
    return { messages, toolCalls, generativeUi };
  }

  private get duration(): string {
    const t = this.metadata;
    if (!t?.createdAt || !t?.updatedAt) return "—";
    const ms =
      new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime();
    if (ms < 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  }

  private toggleToolExpand(id: string): void {
    const next = new Set(this._expandedTools);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedTools = next;
  }

  private toggleMessageExpand(id: string): void {
    const next = new Set(this._expandedMessages);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedMessages = next;
  }

  private toggleTimelineDetails(id: string): void {
    const next = new Set(this._expandedTimelineDetails);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedTimelineDetails = next;
  }

  private expandTimelineDetails(ids: string[]): void {
    this._expandedTimelineDetails = new Set([
      ...this._expandedTimelineDetails,
      ...ids,
    ]);
  }

  private collapseTimelineDetails(ids: string[]): void {
    const next = new Set(this._expandedTimelineDetails);
    for (const id of ids) next.delete(id);
    this._expandedTimelineDetails = next;
  }

  private toggleRawEventDetails(id: string): void {
    const next = new Set(this._expandedRawEvents);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedRawEvents = next;
  }

  private expandRawEventDetails(ids: string[]): void {
    this._expandedRawEvents = new Set([...this._expandedRawEvents, ...ids]);
  }

  private collapseRawEventDetails(ids: string[]): void {
    const next = new Set(this._expandedRawEvents);
    for (const id of ids) next.delete(id);
    this._expandedRawEvents = next;
  }

  private rawEventId(event: ApiAgentEvent): string {
    return `raw-event-${event.sourceIndex ?? event.timestamp ?? event.type}`;
  }

  private get activeEvents(): ApiAgentEvent[] {
    // When the endpoint explicitly returned 501 we report no events rather
    // than leaking the parent's agent-keyed live events across historical
    // threads (those would render identically for every thread on the same
    // agent and mislead the reader).
    if (this._eventsNotAvailable) return [];
    const events = this._fetchedEvents ?? this.agentEventsInput ?? [];
    if (events.every((event) => event.sourceIndex != null)) return events;
    if (this._liveEventsWithSourceIndexCache?.events === events) {
      return this._liveEventsWithSourceIndexCache.indexedEvents;
    }
    const indexedEvents = events.map((event, index) =>
      event.sourceIndex == null ? { ...event, sourceIndex: index + 1 } : event,
    );
    this._liveEventsWithSourceIndexCache = { events, indexedEvents };
    return indexedEvents;
  }

  private get activeState(): Record<string, unknown> | null {
    if (this._stateNotAvailable) return null;
    return this._fetchedState ?? this.agentStateInput ?? null;
  }

  private hasRenderableState(): boolean {
    const s = this.activeState;
    return !!s && typeof s === "object" && Object.keys(s).length > 0;
  }

  private shortId(id: string | null | undefined): string {
    if (!id) return "—";
    return id.length > 20 ? id.slice(0, 8) + "…" : id;
  }

  private get metadata(): ThreadDebuggerMetadata | null {
    return this._fetchedMetadata ?? this.thread ?? null;
  }

  private fmtTime(dateStr: string | null | undefined): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  private onDetailDividerDown = (event: PointerEvent): void => {
    this._dividerResizing = true;
    this._dividerPointerId = event.pointerId;
    this._dividerStartX = event.clientX;
    this._dividerStartWidth = this._detailPanelWidth;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private onDetailDividerMove = (event: PointerEvent): void => {
    if (!this._dividerResizing || this._dividerPointerId !== event.pointerId)
      return;
    const delta = this._dividerStartX - event.clientX;
    this._detailPanelWidth = Math.max(
      160,
      Math.min(400, this._dividerStartWidth + delta),
    );
  };

  private onDetailDividerUp = (event: PointerEvent): void => {
    if (this._dividerPointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this._dividerPointerId)) {
      target.releasePointerCapture(this._dividerPointerId);
    }
    this._dividerResizing = false;
  };

  render() {
    return html`
      <div class="cpk-td">
        <!-- ── Left area: tabs + content ─────────────────────────────────── -->
        <div class="cpk-td__left">
          <!-- Tab bar -->
          <div class="cpk-td__tabs-header">
            <div
              class="cpk-td__tab-group"
              role="tablist"
              aria-label="Thread detail views"
            >
              ${CpkThreadInspector.TAB_LIST.map(
                (tab) => html`
                  <button
                    id=${this.tabDomId(tab.id)}
                    type="button"
                    role="tab"
                    aria-controls=${this.panelDomId(tab.id)}
                    aria-selected=${this._tab === tab.id ? "true" : "false"}
                    tabindex=${this._tab === tab.id ? "0" : "-1"}
                    class="cpk-td__tab ${
                      this._tab === tab.id ? "cpk-td__tab--active" : ""
                    }"
                    @click=${() => this.activateTab(tab.id)}
                    @keydown=${(event: KeyboardEvent) =>
                      this.handleTabKeyDown(event, tab.id)}
                  >
                    ${tab.label}
                  </button>
                `,
              )}
            </div>
            ${this.renderPanelToggle()}
          </div>
          ${this.renderMetadataStrip()}

          <!-- Scrollable content -->
          <div class="cpk-td__content">
            ${
              this._panelInitializing
                ? html`
                    <div class="cpk-td__status">Loading…</div>
                  `
                : nothing
            }
            ${CpkThreadInspector.TAB_LIST.map((tab) =>
              this._activatedTabs.has(tab.id)
                ? html`<div
                    id=${this.panelDomId(tab.id)}
                    class="cpk-td__panel"
                    role="tabpanel"
                    aria-labelledby=${this.tabDomId(tab.id)}
                    ?hidden=${this._tab !== tab.id || this._panelInitializing}
                  >
                    ${this.renderTabContent(tab.id)}
                  </div>`
                : nothing,
            )}
          </div>
        </div>

        <!--
          Drawer always rendered so width animates between 0 and its
          target. Divider lives INSIDE the drawer and is absolutely
          positioned over its left edge so the toggle (rightmost of the
          tab row) and the drawer touch with no flex-gap between them.
        -->
        <div
          class="cpk-td__detail"
          data-open=${this._showDetailPanel ? "true" : "false"}
          style="width:${this._showDetailPanel ? this._detailPanelWidth : 0}px"
          aria-hidden=${this._showDetailPanel ? "false" : "true"}
        >
          ${
            this._showDetailPanel
              ? html`
                <div
                  class="cpk-td__detail-divider"
                  @pointerdown=${this.onDetailDividerDown}
                  @pointermove=${this.onDetailDividerMove}
                  @pointerup=${this.onDetailDividerUp}
                  @pointercancel=${this.onDetailDividerUp}
                ></div>
              `
              : nothing
          }
          ${this.renderDetailPanel()}
        </div>
      </div>
    `;
  }

  private renderMetadataStrip() {
    const metadata = this.metadata;
    const pills: Array<{ label: string; value: string; wrap?: boolean }> = [
      {
        label: "Name",
        value: metadata?.name ?? this.thread?.name ?? "Untitled",
      },
      { label: "ID", value: metadata?.id ?? this.threadId ?? "—", wrap: true },
    ];
    for (const fact of [
      { label: "Agent", value: metadata?.agentId },
      { label: "Created", value: metadata?.createdAt },
      { label: "Updated", value: metadata?.updatedAt },
    ]) {
      if (fact.value == null || fact.value === "") continue;
      pills.push({
        label: fact.label,
        value:
          fact.label === "Created" || fact.label === "Updated"
            ? this.fmtTime(fact.value)
            : fact.value,
      });
    }
    const bulkControls = this.renderActiveBulkControls();

    return html`
      <div
        class="cpk-td__metadata-strip"
        role="group"
        aria-label="Thread metadata"
      >
        <div class="cpk-td__metadata-pills">
          ${pills.map(
            (pill) => html`
              <span
                class="cpk-td__metadata-pill ${
                  pill.wrap ? "cpk-td__metadata-pill--wrap" : ""
                }"
                role="group"
                title=${pill.value}
                aria-label=${`${pill.label}: ${pill.value}`}
              >
                <span class="cpk-td__metadata-label">${pill.label}</span>
                <span
                  class="cpk-td__metadata-value ${
                    pill.wrap ? "cpk-td__metadata-value--wrap" : ""
                  }"
                  >${pill.value}</span
                >
              </span>
            `,
          )}
        </div>
        ${this.renderViewInAppAction()}
        ${bulkControls}
      </div>
    `;
  }

  private renderViewInAppAction() {
    if (this.viewInAppMode === "hidden") return nothing;
    const isStop = this.viewInAppMode === "stop";
    return html`
      <button
        type="button"
        class="cpk-td__view-in-app ${isStop ? "cpk-td__view-in-app--stop" : ""}"
        data-testid="cpk-inspector-view-in-app"
        aria-label=${
          isStop
            ? "Stop viewing this thread in the app"
            : "View this thread in your app"
        }
        @click=${() => {
          this.dispatchEvent(
            new CustomEvent(isStop ? "stopViewing" : "viewInApp", {
              bubbles: true,
              composed: true,
            }),
          );
        }}
      >
        ${isStop ? "Stop viewing" : "View in your app"}
      </button>
      ${
        this.viewInAppError
          ? html`<span class="cpk-td__view-in-app-error" role="alert"
              >${this.viewInAppError}</span
            >`
          : nothing
      }
    `;
  }

  private renderActiveBulkControls() {
    if (this._eventsNotAvailable) return nothing;
    if (this._tab === "raw-events") return this.renderRawEventBulkControls();
    if (this._tab !== "timeline") return nothing;

    const detailIds = this.timelineItemsForEvents(this.activeEvents)
      .filter((item) => item.details)
      .map((item) => item.id);
    if (detailIds.length <= 1) return nothing;

    const allExpanded = detailIds.every((id) =>
      this._expandedTimelineDetails.has(id),
    );
    const allCollapsed = detailIds.every(
      (id) => !this._expandedTimelineDetails.has(id),
    );

    return html`<div class="cpk-td__timeline-toolbar">
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allExpanded}
        @click=${() => this.expandTimelineDetails(detailIds)}
      >
        Expand all
      </button>
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allCollapsed}
        @click=${() => this.collapseTimelineDetails(detailIds)}
      >
        Collapse all
      </button>
    </div>`;
  }

  private renderRawEventBulkControls() {
    const eventIds = this.activeEvents.map((event) => this.rawEventId(event));
    if (eventIds.length <= 1) return nothing;

    const allExpanded = eventIds.every((id) => this._expandedRawEvents.has(id));
    const allCollapsed = eventIds.every(
      (id) => !this._expandedRawEvents.has(id),
    );

    return html`<div class="cpk-td__timeline-toolbar">
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allExpanded}
        @click=${() => this.expandRawEventDetails(eventIds)}
      >
        Expand all
      </button>
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allCollapsed}
        @click=${() => this.collapseRawEventDetails(eventIds)}
      >
        Collapse all
      </button>
    </div>`;
  }

  private revealSourceEvent(sourceIndex: number): void {
    this._activatedTabs = new Set([...this._activatedTabs, "raw-events"]);
    this._tab = "raw-events";
    this.requestUpdate();
    requestAnimationFrame(() => {
      const source = this.shadowRoot?.querySelector<HTMLElement>(
        `[data-source-index="${sourceIndex}"]`,
      );
      source?.scrollIntoView?.({ block: "center" });
    });
  }

  private renderTimeline() {
    if (this._loadingEvents) {
      return html`
        <div class="cpk-td__status">Loading timeline…</div>
      `;
    }
    if (this._eventsError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._eventsError}
      </div>`;
    }
    if (this._eventsNotAvailable) {
      if (this._conversation.length > 0) return this.renderConversation();
      if (this._loadingMessages) return this.renderConversation();
      return html`
        <div class="cpk-td__empty-state">
          <span>Timeline event history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread AG-UI events. Check State for
            the latest snapshot when available.</span
          >
        </div>
      `;
    }

    const events = this.activeEvents;
    const cachedTimeline = this.getCachedPanelTpl("timeline", [
      events,
      this._expandedTimelineDetails,
    ]);
    if (cachedTimeline) return cachedTimeline;

    const timelineItems = this.timelineItemsForEvents(events);
    if (timelineItems.length === 0) {
      if (this._conversation.length > 0) return this.renderConversation();
      if (this._loadingMessages) return this.renderConversation();
      return html`
        <div class="cpk-td__empty-state">
          <span>No timeline events captured</span>
          <span class="cpk-td__empty-hint"
            >Timeline rows are normalized from AG-UI events. Open AG-UI Events or State
            to inspect the available thread data.</span
          >
        </div>
      `;
    }

    return this.cachedPanelTpl(
      "timeline",
      [events, this._expandedTimelineDetails],
      () => html`${timelineItems.map((item) => this.renderTimelineItem(item))}`,
    );
  }

  private renderTimelineItem(item: TimelineItem) {
    const isWarning = item.kind === "warning";
    const detailsExpanded = this._expandedTimelineDetails.has(item.id);
    return html`
      <div
        class="cpk-td__timeline-item ${
          isWarning ? "cpk-td__timeline-item--warning" : ""
        }"
        data-message-id=${item.messageId ?? nothing}
      >
        <div class="cpk-td__timeline-header">
          <span class="cpk-td__timeline-kind"
            >${item.severity === "error" ? "error" : item.kind}</span
          >
          <span class="cpk-td__timeline-title">${item.title}</span>
          <button
            type="button"
            class="cpk-td__source-link"
            @click=${() => this.revealSourceEvent(item.sourceIndex)}
          >
            Source event #${item.sourceIndex}
          </button>
          <span class="cpk-td__timeline-time"
            >${formatTimestamp(item.timestamp)}</span
          >
        </div>
        ${
          item.details
            ? html`<button
              type="button"
              class="cpk-td__timeline-details-toggle"
              aria-expanded=${detailsExpanded ? "true" : "false"}
              @click=${() => this.toggleTimelineDetails(item.id)}
            >
              ${
                detailsExpanded
                  ? html`
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    `
                  : html`
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    `
              }
              <span>${detailsExpanded ? "Hide details" : "Show details"}</span>
            </button>`
            : nothing
        }
        ${
          item.body
            ? html`<div class="cpk-td__timeline-body">${item.body}</div>`
            : nothing
        }
        ${
          item.details && detailsExpanded
            ? html`<pre class="cpk-td__timeline-body">
${unsafeHTML(highlightedJson(item.details))}</pre
            >`
            : nothing
        }
      </div>
    `;
  }

  private renderConversation() {
    if (this._loadingMessages) {
      return html`
        <div class="cpk-td__status">Loading messages…</div>
      `;
    }
    if (this._messagesError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._messagesError}
      </div>`;
    }
    if (this._conversation.length === 0) {
      return html`
        <div class="cpk-td__empty-state">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>No messages yet</span>
        </div>
      `;
    }
    // Expand state is part of the cache key because clicking a tool-call
    // header or the "Show more" button on a long message replaces
    // `_expandedTools` / `_expandedMessages` without touching
    // `_conversation` — without those keys the cache returns the
    // pre-toggle template and the disclosure appears broken.
    return this.cachedPanelTpl(
      "timeline-fallback",
      [this._conversation, this._expandedTools, this._expandedMessages],
      () => {
        const items = this.renderItems;
        return html`${items.map((item) => this.renderRenderItem(item))}`;
      },
    );
  }

  /**
   * Memoize the rendered TemplateResult for `slot` keyed by tuple
   * element-wise reference equality. The hot path for tab switches: when
   * the underlying data hasn't changed, return the previously built
   * TemplateResult so Lit's diff short-circuits. Each panel's `key` is
   * the tuple of inputs the template reads — pass everything the template
   * depends on, or the cache will return stale output when those inputs
   * change without the listed key flipping.
   */
  private cachedPanelTpl(
    slot: ThreadDetailsPanelCacheSlot,
    key: readonly unknown[],
    build: () => TemplateResult,
  ): TemplateResult {
    const cached = this.getCachedPanelTpl(slot, key);
    if (cached) return cached;
    const tpl = build();
    this._panelTplCache.set(slot, { key, tpl });
    return tpl;
  }

  private getCachedPanelTpl(
    slot: ThreadDetailsPanelCacheSlot,
    key: readonly unknown[],
  ): TemplateResult | null {
    const cached = this._panelTplCache.get(slot);
    if (
      cached &&
      cached.key.length === key.length &&
      cached.key.every((v, i) => v === key[i])
    ) {
      return cached.tpl;
    }
    return null;
  }

  private renderRenderItem(item: RenderItem) {
    switch (item.type) {
      case "user":
      case "assistant":
        return this.renderBubble(item);
      case "tool_call":
        return this.renderToolBlock(item);
      case "tool_call_group":
        return this.renderToolGroup(item);
      case "reasoning":
        return html`<div class="cpk-td__inline-chip">
          <span>Reasoned for ${item.duration}</span>
        </div>`;
      case "state_update":
        return html`
          <div class="cpk-td__inline-chip">
            <span>Updated agent state</span>
          </div>
        `;
      case "generative-ui":
        return this.renderGenerativeUI(item);
      case "agent_responded":
        return nothing;
    }
  }

  private renderBubble(item: ConversationUser | ConversationAssistant) {
    const isUser = item.type === "user";
    const threshold = CpkThreadInspector.COLLAPSE_THRESHOLD;
    const expanded = this._expandedMessages.has(item.id);
    const tooLong = item.content.length > threshold;
    const shown =
      tooLong && !expanded
        ? item.content.slice(0, threshold) + "…"
        : item.content;
    return html`
      <div
        class="cpk-td__bubble ${
          isUser ? "cpk-td__bubble--user" : "cpk-td__bubble--assistant"
        }"
        data-message-id=${item.id}
      >
        <div
          class="cpk-td__bubble-inner ${
            isUser
              ? "cpk-td__bubble-inner--user"
              : "cpk-td__bubble-inner--assistant"
          }"
        >
          ${shown}
          ${
            tooLong
              ? html`<span
                class="cpk-td__show-more"
                @click=${() => this.toggleMessageExpand(item.id)}
                >${expanded ? "Show less" : "Show more"}</span
              >`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private renderToolBlock(item: ConversationToolCall) {
    const expanded = this._expandedTools.has(item.id);
    return html`
      <div class="cpk-td__tool-block">
        <div
          class="cpk-td__tool-header"
          @click=${() => this.toggleToolExpand(item.id)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1 9C1 9 2 7 5 7C8 7 9 9 9 9M5 1C5 1 7 2.5 7 4.5C7 6.5 5 7 5 7C5 7 3 6.5 3 4.5C3 2.5 5 1 5 1Z"
              stroke="#087653"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="cpk-td__tool-name">${item.toolName}</span>
          ${
            item.result || Object.keys(item.arguments).length > 0
              ? html`
                  <span class="cpk-td__tool-status">DONE</span>
                `
              : html`
                  <span class="cpk-td__tool-status cpk-td__tool-status--pending">PENDING</span>
                `
          }
          <span class="cpk-td__tool-chevron">${expanded ? "▾" : "▸"}</span>
        </div>
        ${
          expanded
            ? html`
              <div class="cpk-td__tool-body">
                <div class="cpk-td__tool-section-label">Arguments</div>
                <pre class="cpk-td__tool-pre">
${unsafeHTML(highlightedJson(item.arguments))}</pre
                >
                ${
                  item.result
                    ? html`
                      <div
                        class="cpk-td__tool-section-label"
                        style="margin-top:8px"
                      >
                        Result
                      </div>
                      <pre class="cpk-td__tool-pre">
${unsafeHTML(highlightedJson(item.result))}</pre
                      >
                    `
                    : nothing
                }
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  private renderToolGroup(group: ToolCallGroup) {
    return html`
      <div class="cpk-td__tool-group">
        <div class="cpk-td__tool-group-header">
          ${group.items.length} tool call${group.items.length !== 1 ? "s" : ""}
        </div>
        ${group.items.map((tc) => this.renderToolBlock(tc))}
      </div>
    `;
  }

  private renderGenerativeUI(item: ConversationGenerativeUIItem) {
    return html`
      <div class="cpk-td__genui">
        <div class="cpk-td__genui-badge">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Generative UI
        </div>
        <div class="cpk-td__genui-placeholder">
          ${item.activityType} — rendered in chat
        </div>
      </div>
    `;
  }

  private renderState() {
    if (this._loadingState) {
      return html`
        <div class="cpk-td__status">Loading state…</div>
      `;
    }
    if (this._stateError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._stateError}
      </div>`;
    }
    if (this._stateNotAvailable) {
      return html`
        <div class="cpk-td__empty-state">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <span>State history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread agent state. Available when
            running against the in-memory runner.</span
          >
        </div>
      `;
    }
    if (!this.hasRenderableState()) {
      return html`
        <div class="cpk-td__empty-state">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <span>No state captured</span>
          <span class="cpk-td__empty-hint"
            >Emitted live from STATE_SNAPSHOT events.</span
          >
        </div>
      `;
    }
    const stateValue = this.activeState;
    return this.cachedPanelTpl("state", [stateValue], () => {
      return renderHighlightedJsonBlock(stateValue);
    });
  }

  private renderEvents() {
    if (this._loadingEvents) {
      return html`
        <div class="cpk-td__status">Loading events…</div>
      `;
    }
    if (this._eventsError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._eventsError}
      </div>`;
    }
    if (this._eventsNotAvailable) {
      return html`
        <div class="cpk-td__empty-state">
          <span>Event history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread AG-UI events. Available when
            running against the in-memory runner.</span
          >
        </div>
      `;
    }
    const events = this.activeEvents;
    if (events.length === 0) {
      return html`
        <div class="cpk-td__empty-state">
          <span>No events captured</span>
          <span class="cpk-td__empty-hint"
            >Events are recorded live. Run the agent to see them here.</span
          >
        </div>
      `;
    }
    return this.cachedPanelTpl(
      "raw-events",
      [events, this._expandedRawEvents],
      () => {
        return html`${events.map((event) => {
          const { bg, fg } = eventColors(event.type);
          const eventId = this.rawEventId(event);
          const detailsExpanded = this._expandedRawEvents.has(eventId);
          return html`
            <div class="cpk-td__event" data-source-index=${event.sourceIndex}>
              <div class="cpk-td__event-header" style="background:${bg}">
                <span class="cpk-td__event-type" style="color:${fg}"
                  >${event.type}</span
                >
                <span class="cpk-td__event-time"
                  >${formatTimestamp(event.timestamp)}</span
                >
              </div>
              <button
                type="button"
                class="cpk-td__timeline-details-toggle"
                aria-expanded=${detailsExpanded ? "true" : "false"}
                @click=${() => this.toggleRawEventDetails(eventId)}
              >
                ${
                  detailsExpanded
                    ? html`
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      `
                    : html`
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      `
                }
                <span
                  >${detailsExpanded ? "Hide details" : "Show details"}</span
                >
              </button>
              ${
                detailsExpanded
                  ? html`<pre class="cpk-td__event-payload">
${unsafeHTML(highlightedJson(event.rawEvent ?? event))}</pre
                  >`
                  : nothing
              }
            </div>
          `;
        })}`;
      },
    );
  }

  private renderPanelToggle() {
    return html`
      <button
        class="cpk-td__panel-toggle ${
          this._showDetailPanel ? "cpk-td__panel-toggle--active" : ""
        }"
        @click=${() => {
          this._showDetailPanel = !this._showDetailPanel;
        }}
        title="Toggle thread details"
        type="button"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>
    `;
  }

  private renderDetailPanel() {
    const counts = this.activityCounts;
    const metadata = this.metadata;
    return html`
      <!-- Thread -->
      <div class="cpk-tdp__section-title">Thread</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">ID</span>
        <span class="cpk-tdp__value cpk-tdp__value--wrap"
          >${metadata?.id ?? this.threadId ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Name</span>
        <span class="cpk-tdp__value">${metadata?.name ?? "—"}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Agent</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.agentId ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">End user</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.endUserId ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Created by</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.createdById ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Status</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.status ?? "—"}</span
        >
      </div>

      <div class="cpk-tdp__divider"></div>

      <!-- Timestamps -->
      <div class="cpk-tdp__section-title">Timestamps</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Created</span>
        <span class="cpk-tdp__value">${this.fmtTime(metadata?.createdAt)}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Updated</span>
        <span class="cpk-tdp__value">${this.fmtTime(metadata?.updatedAt)}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Duration</span>
        <span class="cpk-tdp__value">${this.duration}</span>
      </div>

      <div class="cpk-tdp__divider"></div>

      <!-- Activity -->
      <div class="cpk-tdp__section-title">Activity</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Messages</span>
        <span class="cpk-tdp__value">${counts.messages}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Tool calls</span>
        <span class="cpk-tdp__value">${counts.toolCalls}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">AG-UI events</span>
        <span class="cpk-tdp__value">${this.activeEvents.length}</span>
      </div>
    `;
  }
}

// ─── memory recall relevance helpers ─────────────────────────────────────────

/**
 * Normalizes a memory's raw recall score to a 0..1 relevance ratio relative to
 * the strongest result in the same result set. Recall scores are RRF scores
 * (relative), so a bar is only meaningful against the set max. Returns
 * `undefined` when no meaningful ranking exists (empty set, non-positive max,
 * missing score) so the caller renders no bar.
 */
function normalizeRelevance(
  score: number | undefined,
  maxScore: number,
): number | undefined {
  if (maxScore <= 0) return undefined;
  if (score === undefined || !Number.isFinite(score)) return undefined;
  const ratio = score / maxScore;
  if (ratio <= 0) return 0;
  return ratio > 1 ? 1 : ratio;
}

/** Largest finite `score` across a result set, or 0 when none present. */
function maxRecallScore(memories: readonly Memory[]): number {
  let max = 0;
  for (const m of memories) {
    const s = m.score;
    if (typeof s === "number" && Number.isFinite(s) && s > max) max = s;
  }
  return max;
}

/**
 * Percent width for a relevance bar. Mirrors the banking reference
 * (`max(6, round(rel*100))%`) so a matched-but-weak result still shows a sliver.
 * Returns a whole number in [6, 100].
 */
function relevanceBarWidth(relevance: number): number {
  return Math.max(6, Math.min(100, Math.round(relevance * 100)));
}

export {
  normalizeRelevance as ɵnormalizeRelevance,
  maxRecallScore as ɵmaxRecallScore,
  relevanceBarWidth as ɵrelevanceBarWidth,
};

// ─── cpk-memory-list ─────────────────────────────────────────────────────────

/** Memory kind values including the "all" sentinel used by the filter UI. */
type MemoryKindFilter = "all" | "topical" | "episodic" | "operational";

class CpkMemoryList extends PortableLitElement {
  static properties = {
    memories: { attribute: false },
    recallResults: { attribute: false },
    recallLoading: { attribute: false },
    recallError: { attribute: false },
    recallQueryText: { attribute: false },
    search: { state: true },
    kind: { state: true },
  };

  /** Ordered (newest-first) list of memories supplied by the parent. */
  memories: Memory[] = [];
  /** Semantic-recall results. `null` = no recall run (section hidden); `[]` = ran, no matches. */
  recallResults: Memory[] | null = null;
  /** True while a recall request is in flight. */
  recallLoading = false;
  /** Error message from the most recent recall attempt, or null. */
  recallError: string | null = null;
  /** The recall input text (owned by the parent). */
  recallQueryText = "";
  private search = "";
  private kind: MemoryKindFilter = "all";

  static styles = css`
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .cpk-ml {
      font-family: "Plus Jakarta Sans", sans-serif;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: #f7f7f9;
    }

    /* ── Search ── */
    .cpk-ml__search {
      padding: 10px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
    }

    .cpk-ml__search-input {
      width: 100%;
      box-sizing: border-box;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid #dbdbe5;
      background: #ffffff;
      color: #010507;
      outline: none;
      transition: border-color 0.15s;
    }

    .cpk-ml__search-input:focus {
      border-color: #bec2ff;
    }

    /* ── Kind filter ── */
    .cpk-ml__filter {
      display: flex;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .cpk-ml__filter-seg {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 9px;
      border-radius: 6px;
      border: 1px solid #dbdbe5;
      background: #ffffff;
      color: #57575b;
      cursor: pointer;
      transition:
        background 0.1s,
        border-color 0.1s,
        color 0.1s;
      user-select: none;
    }

    .cpk-ml__filter-seg:hover {
      background: #f0f0f5;
    }

    .cpk-ml__filter-seg--active {
      background: #bec2ff1a;
      border-color: #bec2ff;
      color: #010507;
    }

    .cpk-ml__filter-count {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      margin-left: 4px;
      color: #68686e;
    }

    /* ── List ── */
    .cpk-ml__list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* ── Card ── */
    .cpk-ml__card {
      background: #ffffff;
      border: 1px solid #e9e9ef;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cpk-ml__card-badges {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* Kind badge — color per kind */
    .cpk-ml__kind-badge {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      padding: 1px 7px;
      border-radius: 5px;
      text-transform: uppercase;
      font-weight: 500;
      white-space: nowrap;
    }

    .cpk-ml__kind-badge--topical {
      background: #eee6fe;
      color: #57575b;
    }

    .cpk-ml__kind-badge--episodic {
      background: #e6f4fe;
      color: #2d5f80;
    }

    .cpk-ml__kind-badge--operational {
      background: #e6feee;
      color: #2d6645;
    }

    /* Scope badge */
    .cpk-ml__scope-badge {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      padding: 1px 7px;
      border-radius: 5px;
      text-transform: uppercase;
      font-weight: 500;
      white-space: nowrap;
      background: #f0f0f5;
      color: #68686e;
    }

    /* Content */
    .cpk-ml__content {
      font-size: 12px;
      color: #010507;
      line-height: 1.5;
      word-break: break-word;
    }

    /* Footer */
    .cpk-ml__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 2px;
    }

    .cpk-ml__footer-threads {
      font-size: 10px;
      color: #68686e;
    }

    .cpk-ml__footer-id {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      color: #c0c0c8;
    }

    /* ── Empty state ── */
    .cpk-ml__empty {
      padding: 32px 16px;
      text-align: center;
      color: #68686e;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .cpk-ml__empty-icon {
      color: #c0c0c8;
    }

    /* ── Recall ── */
    .cpk-ml__recall {
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
    }
    .cpk-ml__recall-input {
      flex: 1;
      box-sizing: border-box;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid #dbdbe5;
      background: #fff;
      color: #010507;
      outline: none;
      transition: border-color 0.15s;
    }
    .cpk-ml__recall-input:focus {
      border-color: #bec2ff;
    }
    .cpk-ml__recall-btn {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      font-weight: 500;
      padding: 7px 12px;
      border-radius: 7px;
      border: 1px solid #dbdbe5;
      background: #fff;
      color: #010507;
      cursor: pointer;
      transition: background 0.1s;
    }
    .cpk-ml__recall-btn:hover:not(:disabled) {
      background: #f0f0f5;
    }
    .cpk-ml__recall-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .cpk-ml__recall-section {
      flex-shrink: 0;
      max-height: 45%;
      overflow-y: auto;
      padding: 8px 12px;
      border-bottom: 1px solid #dbdbe5;
      background: #fbfbfd;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cpk-ml__recall-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .cpk-ml__recall-title {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: #010507;
    }
    .cpk-ml__recall-clear {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 10px;
      color: #68686e;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
    }
    .cpk-ml__recall-clear:hover {
      color: #010507;
    }
    .cpk-ml__recall-msg {
      font-size: 11px;
      color: #68686e;
      line-height: 1.45;
    }
    .cpk-ml__recall-msg--error {
      color: #c0333a;
    }

    /* ── Relevance bar ── */
    .cpk-ml__relevance {
      height: 4px;
      width: 100%;
      overflow: hidden;
      border-radius: 9999px;
      background: #f0f0f5;
    }
    .cpk-ml__relevance-fill {
      height: 100%;
      border-radius: 9999px;
      background: #6366f1;
    }

    /* ── Scope badge variants ── */
    .cpk-ml__scope-badge--user {
      background: #f0f0f5;
      color: #68686e;
    }
    .cpk-ml__scope-badge--project {
      background: #fef3c7;
      color: #92660c;
    }

    :host([data-color-scheme="dark"]) {
      color-scheme: dark;
    }

    :host([data-color-scheme="dark"]) .cpk-ml {
      background: #15171e;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__search,
    :host([data-color-scheme="dark"]) .cpk-ml__filter,
    :host([data-color-scheme="dark"]) .cpk-ml__recall,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-section,
    :host([data-color-scheme="dark"]) .cpk-ml__card {
      border-color: #343742;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__search-input,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-input,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-btn,
    :host([data-color-scheme="dark"]) .cpk-ml__filter-seg,
    :host([data-color-scheme="dark"]) .cpk-ml__card {
      border-color: #464957;
      background: #191c24;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__recall-section {
      background: #171a22;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__filter-seg:hover,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-btn:hover:not(:disabled) {
      background: #20232d;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__filter-seg--active {
      border-color: #777aae;
      background: #292b43;
      color: #d8d9ff;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__content,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-title {
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-ml__filter-count,
    :host([data-color-scheme="dark"]) .cpk-ml__footer-threads,
    :host([data-color-scheme="dark"]) .cpk-ml__footer-id,
    :host([data-color-scheme="dark"]) .cpk-ml__empty,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-clear,
    :host([data-color-scheme="dark"]) .cpk-ml__recall-msg {
      color: #aeb1bd;
    }
  `;

  /** Memories that pass the current text search (before kind filter). */
  private get searchFiltered(): Memory[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.memories;
    return this.memories.filter((m) => m.content.toLowerCase().includes(q));
  }

  /** Memories that pass both search and kind filter. */
  private get filtered(): Memory[] {
    const searched = this.searchFiltered;
    if (this.kind === "all") return searched;
    return searched.filter((m) => m.kind === this.kind);
  }

  /** Count of search-filtered memories for a given kind (for segment labels). */
  private countForKind(kind: Exclude<MemoryKindFilter, "all">): number {
    return this.searchFiltered.filter((m) => m.kind === kind).length;
  }

  private onSearchInput = (event: Event): void => {
    this.search = (event.target as HTMLInputElement).value;
  };

  private onKindClick = (event: Event): void => {
    const seg = (event.target as HTMLElement).closest("[data-kind]");
    if (!seg) return;
    const k = (seg as HTMLElement).dataset["kind"] as MemoryKindFilter;
    this.kind = k;
  };

  /** Truncate an id to first-4…last-4 characters. */
  private shortId(id: string): string {
    if (id.length <= 12) return id;
    return `${id.slice(0, 4)}…${id.slice(-4)}`;
  }

  private renderKindBadge(kind: string): TemplateResult {
    return html`<span class="cpk-ml__kind-badge cpk-ml__kind-badge--${kind}"
      >${kind}</span
    >`;
  }

  private renderScopeBadge(scope: string): TemplateResult {
    const variant = scope === "project" ? "project" : "user";
    return html`<span
      class="cpk-ml__scope-badge cpk-ml__scope-badge--${variant}"
      >${scope}</span
    >`;
  }

  /**
   * Renders one memory card. `relevance` (0..1) is supplied only for recall
   * results — when present a relevance bar is drawn; the full list omits it.
   */
  private renderCard(m: Memory, relevance?: number): TemplateResult {
    const threads = m.sourceThreadIds.length;
    return html`
      <div class="cpk-ml__card">
        <div class="cpk-ml__card-badges">
          ${this.renderKindBadge(m.kind)}${this.renderScopeBadge(m.scope)}
        </div>
        <div class="cpk-ml__content">${m.content}</div>
        ${
          relevance !== undefined
            ? html`<div class="cpk-ml__relevance">
              <div
                class="cpk-ml__relevance-fill"
                style="width:${relevanceBarWidth(relevance)}%;"
              ></div>
            </div>`
            : nothing
        }
        <div class="cpk-ml__footer">
          <span class="cpk-ml__footer-threads"
            >${threads} source thread${threads === 1 ? "" : "s"}</span
          >
          <span class="cpk-ml__footer-id">${this.shortId(m.id)}</span>
        </div>
      </div>
    `;
  }

  private onRecallInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value;
    this.recallQueryText = value;
    this.dispatchEvent(
      new CustomEvent<string>("recallQueryChanged", {
        detail: value,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private onRecallSubmit = (event: Event): void => {
    event.preventDefault();
    const query = this.recallQueryText.trim();
    if (query.length === 0 || this.recallLoading) return;
    this.dispatchEvent(
      new CustomEvent<string>("recallSubmitted", {
        detail: query,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private onRecallClear = (): void => {
    this.dispatchEvent(
      new CustomEvent("recallCleared", { bubbles: true, composed: true }),
    );
  };

  private renderRecallForm(): TemplateResult {
    const disabled =
      this.recallLoading || this.recallQueryText.trim().length === 0;
    return html`
      <form class="cpk-ml__recall" @submit=${this.onRecallSubmit}>
        <input
          type="text"
          placeholder="Recall by meaning…"
          aria-label="Recall learning records by meaning"
          class="cpk-ml__recall-input"
          .value=${this.recallQueryText}
          @input=${this.onRecallInput}
        />
        <button type="submit" class="cpk-ml__recall-btn" ?disabled=${disabled}>
          ${this.recallLoading ? "…" : "Recall"}
        </button>
      </form>
    `;
  }

  private renderRecallSection(): TemplateResult {
    const results = this.recallResults;
    if (results === null) return html``;
    const max = maxRecallScore(results);
    return html`
      <section
        class="cpk-ml__recall-section"
        aria-label="Semantic recall results"
      >
        <div class="cpk-ml__recall-header">
          <span class="cpk-ml__recall-title"
            >Semantic recall (${results.length})</span
          >
          <button
            type="button"
            class="cpk-ml__recall-clear"
            @click=${this.onRecallClear}
          >
            Clear
          </button>
        </div>
        ${
          this.recallError
            ? html`<p class="cpk-ml__recall-msg cpk-ml__recall-msg--error">
              Recall failed: ${this.recallError}
            </p>`
            : results.length === 0
              ? html`
                  <p class="cpk-ml__recall-msg">No learning records matched that query.</p>
                `
              : results.map((m) =>
                  this.renderCard(m, normalizeRelevance(m.score, max)),
                )
        }
      </section>
    `;
  }

  private renderEmpty(): TemplateResult {
    const q = this.search.trim();
    if (this.memories.length === 0) {
      return html`
        <div class="cpk-ml__empty">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="cpk-ml__empty-icon"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          No learning records yet — tell the agent a durable fact and watch it appear.
        </div>
      `;
    }
    if (q) {
      return html`
        <div class="cpk-ml__empty">
          No learning records match &ldquo;${q}&rdquo;.
        </div>
      `;
    }
    return html`
      <div class="cpk-ml__empty">No ${this.kind} learning records yet.</div>
    `;
  }

  render() {
    const filtered = this.filtered;
    const kinds: Array<Exclude<MemoryKindFilter, "all">> = [
      "topical",
      "episodic",
      "operational",
    ];

    return html`
      <div class="cpk-ml">
        <!-- Semantic recall -->
        ${this.renderRecallForm()} ${this.renderRecallSection()}

        <!-- Search -->
        <div class="cpk-ml__search">
          <input
            type="text"
            placeholder="Search learning…"
            .value=${this.search}
            @input=${this.onSearchInput}
            class="cpk-ml__search-input"
          />
        </div>

        <!-- Kind filter -->
        <div class="cpk-ml__filter" @click=${this.onKindClick}>
          <button
            class="cpk-ml__filter-seg ${
              this.kind === "all" ? "cpk-ml__filter-seg--active" : ""
            }"
            data-kind="all"
          >
            All<span class="cpk-ml__filter-count"
              >${this.searchFiltered.length}</span
            >
          </button>
          ${kinds.map(
            (k) => html`
              <button
                class="cpk-ml__filter-seg ${
                  this.kind === k ? "cpk-ml__filter-seg--active" : ""
                }"
                data-kind="${k}"
              >
                ${k}<span class="cpk-ml__filter-count"
                  >${this.countForKind(k)}</span
                >
              </button>
            `,
          )}
        </div>

        <!-- Memory list -->
        <div class="cpk-ml__list">
          ${filtered.map((m) => this.renderCard(m))}
          ${filtered.length === 0 ? this.renderEmpty() : nothing}
        </div>
      </div>
    `;
  }
}

// Backwards-compatible internal element name used by the full CopilotKit
// Inspector shell. Keep this class thin so the public body remains the single
// implementation.
export class ɵCpkThreadDetails extends CpkThreadInspector {}

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
  private _memories: Memory[] = [];
  private _memoriesLoading = false;
  private _memoriesError: Error | null = null;
  private _memoriesAvailable = true;
  // Realtime-connection health, independent of `_memoriesAvailable` (the REST
  // list route). Drives the "live" indicator: only "connected" shows "live".
  private _memoriesRealtimeStatus: MemoryRealtimeStatus = "connecting";
  private _memoryUnsub: (() => void) | null = null;
  // Lazy-subscription guard. The memory store is created + started + opens
  // realtime the first time `core.getMemoryStore()` is called, so we defer
  // that call until the user actually activates the Memories tab (see
  // `ensureMemorySubscription`). This flag prevents a repeated tab click from
  // double-subscribing; `detachFromCore` resets it so a later attach + tab
  // activation re-subscribes cleanly.
  private _memorySubscribed = false;
  // True when the attached core predates `getMemoryStore` (older @copilotkit
  // SDK). Distinct from `_memoriesAvailable` (memory not enabled on an
  // otherwise-current deployment) so the teaser can show upgrade-the-SDK copy.
  private _memoryStoreUnsupported = false;
  // ── Semantic recall (B3) ──────────────────────────────────────────────
  // `null` = no recall run yet (section hidden). `[]` = ran, no matches.
  private _recallResults: Memory[] | null = null;
  private _recallLoading = false;
  private _recallError: string | null = null;
  private _recallQuery = "";
  // Monotonic token so a slow recall resolving after a newer one / Clear /
  // detach is ignored — last-write-wins without racing state.
  private _recallSeq = 0;
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
  private agentSubscriptions: Map<string, () => void> = new Map();
  private agentEvents: Map<string, InspectorEvent[]> = new Map();
  private agentMessages: Map<string, InspectorMessage[]> = new Map();
  // Per-thread monotonic version that ticks every time an agent currently
  // running on that thread emits a message change. `cpk-thread-details`
  // watches this prop and re-fetches `/threads/:id/messages` when it changes,
  // which is how live updates flow into the conversation view without
  // duplicating the runtime's message-shape conversion in the inspector.
  private liveMessageVersion: Map<string, number> = new Map();
  private agentStates: Map<string, SanitizedValue> = new Map();
  private flattenedEvents: InspectorEvent[] = [];
  private eventCounter = 0;
  private contextStore: Record<
    string,
    { description?: string; value: unknown }
  > = {};

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
  private selectedThreadId: string | null = null;
  private inAppThreadId: string | null = null;
  private inAppAgentId: string | null = null;
  private inAppSource: "app" | "override" | null = null;
  private activeViewInAppRequestId: string | null = null;
  private viewInAppError: string | null = null;
  private inspectorBridgeUnsubscribers: Array<() => void> = [];
  private selectedRealThreadIsExplicit = false;
  private selectedLocalExampleThreadId: string | null = null;
  private requestedThreadId: string | null = null;
  private focusedThreadMessageId: string | null = null;
  private threadFocusRequestId = 0;
  private threadListWidth = 290;
  private threadDividerResizing = false;
  private threadDividerPointerId = -1;
  private threadDividerStartX = 0;
  private threadDividerStartWidth = 0;
  private _threads: ɵThread[] = [];
  private _threadStoreSubscriptions: Map<string, () => void> = new Map();
  private _threadsByAgent: Map<string, ɵThread[]> = new Map();
  private threadUsageSignature = "";
  private threadUsageRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  // Error from each agent's thread store (REST list rejection, Phoenix
  // subscribe failure, retry exhaustion). When non-empty for the active
  // selection, the threads view renders an error state instead of stale
  // data with no indication.
  private _threadsErrorByAgent: Map<string, Error> = new Map();
  private _threadsLoadingByAgent: Map<string, boolean> = new Map();
  // Thread stores created and owned by the inspector (keyed by agentId)
  private _ownedThreadStores: Map<string, ɵThreadStore> = new Map();
  private playgroundAgent: AbstractAgent | null = null;
  private playgroundAgentId: string | null = null;
  private playgroundAgentUnsubscribe: (() => void) | null = null;
  private playgroundMessages: InspectorMessage[] = [];
  private playgroundInput = "";
  private playgroundIsRunning = false;
  private playgroundRunStartedAt: number | null = null;
  private playgroundReasoningDurations: Map<string, number> = new Map();
  private playgroundIsLoadingThread = false;
  private playgroundError: string | null = null;
  private playgroundSourceThreadId: string | null = null;
  private playgroundShowEphemeralNotice = false;
  private threadCapabilityEnabled: boolean | null = null;
  private threadCapabilityGeneration = 0;
  private contextMenuOpen = false;
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
  private autoAttachCore = true;
  private attemptedAutoAttach = false;
  private cachedTools: InspectorToolDefinition[] = [];
  private toolSignature = "";
  // Bumped after every core.setToolEnabled / core.setCatalogComponentEnabled
  // call so the Capabilities tab re-paints from the fresh isToolEnabled /
  // isCatalogComponentEnabled getters. There is no core subscriber for
  // enablement changes — the inspector itself drives the toggle, so we force
  // the re-render locally.
  private _capabilitiesVersion = 0;
  private eventFilterText = "";
  private eventTypeFilter: InspectorAgentEventType | "all" = "all";
  // Column widths for the AG-UI events table (agent, time, event-type; last col is auto)
  private evtColWidths = [100, 80, 150];
  private _evtColResize: {
    col: number;
    startX: number;
    startW: number;
  } | null = null;

  private announcementHtml: string | null = null;
  private announcementMarkdown: string | null = null;
  private announcementTimestamp: string | null = null;
  private announcementPreviewText: string | null = null;
  // Forward-compat for an optional `cta_label` field on the announcement
  // CDN payload (e.g. "Try threads", "New feature"). The current schema
  // ({timestamp, previewText, announcement}) doesn't carry it, so this is
  // null in production today; we read it defensively in fetchAnnouncement
  // so a future CDN-side schema bump lights up `cta_label` on
  // whats_new_clicked without an inspector release.
  private announcementCtaLabel: string | null = null;
  private announcementLoaded = false;
  private announcementPromise: Promise<void> | null = null;
  private newsSignalArmed = false;
  /** Which signal's beat is in flight, or null between beats. */
  private pulsingSignal: LauncherSignalKey | null = null;
  /**
   * The single pending-beat slot. A beat that cannot land is deferred, never
   * discarded — see `startSignalPulse` for the four reasons it cannot land.
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
  /** Last time an inspector-owned /threads refresh left this host, per agent. */
  private readonly threadRefreshLastSentAt: Map<string, number> = new Map();
  /** Trailing /threads refresh timers, one per agent. */
  private readonly threadRefreshTrailingTimers: Map<
    string,
    ReturnType<typeof setTimeout>
  > = new Map();
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
  private launcherHudHelp: LauncherHudRowId | null = null;
  private launcherHudCloseTimer: ReturnType<typeof setTimeout> | null = null;
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
  private viewedNewsSignalIds: Set<string> = new Set();
  private pendingNewsSignalViewed: {
    banner_id: string;
    surface: "launcher";
    presentation: WhatsNewSignalPresentation;
    cta_label?: string;
  } | null = null;
  // Per-instance dedup for `oss.inspector.whats_new_viewed`, keyed by
  // `${timestamp}:${surface}` so the event fires at most once per
  // announcement per surface per inspector mount. Plan calls for "de-dup per
  // timestamp per session"; instance-scoping is closer to per-mount than
  // per-tab (sessionStorage), but for the inspector the distinction is
  // academic — inspector instances rarely outlive the page. The surface stays
  // part of the key so a second announcement surface would get its own
  // impression rather than being swallowed by the first one's.
  private viewedBannerSurfaces: Set<string> = new Set();
  // Impressions wait for the runtime handshake before going out: the runtime's
  // opt-out arrives in the /info response, and `telemetryDisabled` reads `false`
  // until then, so sending directly would post on a placeholder. This deferral
  // predates the surface split — preserved here, widened from a single slot to a
  // queue because opening the panel reveals the second surface and can happen
  // before the first impression has flushed.
  private pendingBannerViewed: Array<{
    banner_id: string;
    surface: WhatsNewSurface;
    cta_label?: string;
  }> = [];
  // Per-instance dedup for `oss.inspector.whats_new_clicked` (keyed by
  // `${bannerId}:${cta}`) so copy-button retries and accidental multi-clicks
  // don't inflate funnel counts beyond one signal per intent type per banner.
  private clickedBannerIds: Set<string> = new Set();
  private viewedThreadsTelemetryStates: Set<string> = new Set();
  private viewedExampleKinds: Set<ExampleKind> = new Set();
  private selectedExampleKinds: Set<ExampleKind> = new Set();
  private viewedExampleTourSteps: Set<string> = new Set();
  private exampleThreadProviders: Map<string, ThreadDebuggerProvider> =
    new Map();
  private exampleTourDismissed = false;
  private exampleTourActive = false;
  private exampleTourStep = 0;
  private exampleTourAutoShown = false;
  private threadsExampleOverviewVideoState: ThreadsExampleOverviewVideoState =
    "deferred";
  private threadsExampleOverviewVideoLoaded = false;
  private threadsExampleOverviewVideoReducedMotion = false;
  private threadsExampleOverviewVideoLoadTimer: number | null = null;
  private threadsExampleOverviewVideoIdleCallbackId: number | null = null;
  private threadsExampleOverviewVideoElement: HTMLVideoElement | null = null;
  private threadsExampleOverviewVideoListeners: ThreadsExampleOverviewVideoListeners | null =
    null;
  private threadsExampleOverviewVideoLifecycleGeneration = 0;
  private threadsExampleOverviewVideoPlayAttemptGeneration = 0;
  private threadsExampleOverviewVideoPlayPromise: Promise<void> | null = null;
  private threadsExampleOverviewVideoPlayOnNextBind = false;
  private threadsSetupPromptCopyState: ThreadsSetupPromptCopyState = "idle";
  private threadsSetupPromptCopyResetTimeoutId: number | null = null;
  private threadsSetupPromptCopyGeneration = 0;

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
        key: "whats-new",
        label: "What's New",
        icon: "Megaphone" as LucideIconName,
      },
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

  private getThreadServiceStatus(): ThreadServiceStatus {
    if (!this._core) return "unknown";
    if (!this._core.threadEndpoints) return "unknown";
    return this._core.threadEndpoints?.list === false
      ? "unavailable"
      : "available";
  }

  private areThreadEndpointsAvailable(): boolean {
    const endpoints = this._core?.threadEndpoints;
    return (
      endpoints !== null &&
      typeof endpoints === "object" &&
      endpoints.list !== false
    );
  }

  private synchronizeThreadCapability(): void {
    const enabled = this.areThreadEndpointsAvailable();
    if (this.threadCapabilityEnabled === enabled) return;

    this.threadCapabilityEnabled = enabled;
    this.threadCapabilityGeneration += 1;

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
    if (this.selectedThreadId !== this.selectedLocalExampleThreadId) {
      this.selectedThreadId = null;
      this.selectedLocalExampleThreadId = null;
    }
    this.selectedRealThreadIsExplicit = false;
    this.requestUpdate();
  }

  private getActiveThreadsState(): {
    displayThreads: ɵThread[];
    threadsErrorMessage: string | null;
    threadsLoading: boolean;
  } {
    const displayThreads =
      this.selectedContext === "all-agents"
        ? this._threads
        : (this._threadsByAgent.get(this.selectedContext) ?? []);

    // Surface a thread-store load error inline. For "all-agents" we report
    // the first error encountered across all agents (good enough for a
    // debugging surface — the per-agent context filter narrows down the
    // culprit). For a specific agent we use that agent's error directly.
    let threadsErrorMessage: string | null = null;
    if (this.selectedContext === "all-agents") {
      const firstError = this._threadsErrorByAgent.values().next().value;
      threadsErrorMessage = firstError?.message ?? null;
    } else {
      threadsErrorMessage =
        this._threadsErrorByAgent.get(this.selectedContext)?.message ?? null;
    }

    const threadsLoading =
      this.selectedContext === "all-agents"
        ? Array.from(this._threadsLoadingByAgent.values()).some(Boolean)
        : (this._threadsLoadingByAgent.get(this.selectedContext) ?? false);

    return { displayThreads, threadsErrorMessage, threadsLoading };
  }

  /** Bucket trusted usage without retaining exact counts or limits. */
  private getThreadsUsageBucket(): ThreadsUsageBucket {
    const usage = this.inspectorMetadataProjection.usage;
    if (!usage) return "absent";
    if (usage.used === 0) return "empty";
    if (usage.limit.kind === "finite") {
      return usage.used < usage.limit.value
        ? "within_limit"
        : "at_or_over_limit";
    }
    if (usage.limit.kind === "unlimited") return "unlimited";
    return "unknown_limit";
  }

  /** Classify finite usage for render-only capacity copy and color. */
  private getThreadsCapacityState():
    | "normal"
    | "warning"
    | "critical"
    | undefined {
    const usage = this.inspectorMetadataProjection.usage;
    if (!usage || usage.limit.kind !== "finite") return undefined;
    if (usage.used >= usage.limit.value) return "critical";

    const warningThreshold =
      usage.limit.value - Math.floor(usage.limit.value / 10);
    return usage.used >= warningThreshold ? "warning" : "normal";
  }

  /** Bucket trusted expiry data independently from the usage-limit bucket. */
  private getThreadsExpiryBucket(): ThreadsExpiryBucket {
    const usage = this.inspectorMetadataProjection.usage;
    if (
      !usage ||
      !Object.prototype.hasOwnProperty.call(usage, "expiringSoonCount")
    ) {
      return "unavailable";
    }
    if (usage.expiringSoonCount === 0) return "zero";
    return typeof usage.expiringSoonCount === "number" &&
      usage.expiringSoonCount > 0
      ? "positive"
      : "unavailable";
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
    const { displayThreads, threadsErrorMessage, threadsLoading } =
      this.getActiveThreadsState();
    return !threadsErrorMessage && !threadsLoading && displayThreads.length > 0;
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

  private getMemoriesTelemetryProps(): InspectorMemoryTelemetryProps {
    const distinctId = !this.core?.telemetryDisabled
      ? getTelemetryDistinctIdForUrl()
      : null;
    return {
      posthog_distinct_id: distinctId ?? undefined,
      memory_count: this._memories.length,
      available: this._memoriesAvailable,
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

  private getThreadsRuntimeSetupDocsUrl(): string {
    return this.appendRefParam(
      THREADS_RUNTIME_SETUP_DOCS_URL,
      "cpk-inspector-threads",
    );
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
    const planCode = this.inspectorMetadataProjection.plan?.code
      .trim()
      .toLowerCase();
    if (planCode === "team_self_hosted" || planCode === "team-self-hosted") {
      return {
        href: this.getSelfHostedIntelligenceUrl(),
        label: "Explore self-hosted Intelligence",
      };
    }
    return {
      href: this.getThreadsIntelligenceSignupUrl(),
      label: "Sign up for Intelligence",
    };
  }

  private subscribeToThreadStore(agentId: string, store: ɵThreadStore): void {
    if (!this.areThreadEndpointsAvailable()) return;
    if (this._threadStoreSubscriptions.has(agentId)) return;
    const capabilityGeneration = this.threadCapabilityGeneration;
    const threadsSub = store.select(ɵselectThreads).subscribe((threads) => {
      if (
        capabilityGeneration !== this.threadCapabilityGeneration ||
        !this.areThreadEndpointsAvailable()
      ) {
        return;
      }
      this._threadsByAgent.set(agentId, threads as ɵThread[]);
      this.rebuildFlattenedThreads();
      this.autoSelectLatestThread();
      this.requestUpdate();
    });
    const statusSub = store
      .select(createThreadStoreStatusSelector())
      .subscribe(({ error, isLoading }) => {
        if (
          capabilityGeneration !== this.threadCapabilityGeneration ||
          !this.areThreadEndpointsAvailable()
        ) {
          return;
        }
        if (error) {
          this._threadsErrorByAgent.set(agentId, error);
        } else if (!isLoading) {
          this._threadsErrorByAgent.delete(agentId);
        }
        this._threadsLoadingByAgent.set(agentId, isLoading);
        this.requestUpdate();
      });
    this._threadStoreSubscriptions.set(agentId, () => {
      threadsSub.unsubscribe();
      statusSub.unsubscribe();
    });
    // Populate immediately from current state
    if (
      capabilityGeneration !== this.threadCapabilityGeneration ||
      !this.areThreadEndpointsAvailable()
    ) {
      return;
    }
    const initialState = store.getState();
    this._threadsByAgent.set(agentId, ɵselectThreads(initialState));
    this._threadsLoadingByAgent.set(
      agentId,
      ɵselectThreadsIsLoading(initialState),
    );
    const initialError = ɵselectThreadsError(initialState);
    if (initialError) {
      this._threadsErrorByAgent.set(agentId, initialError);
    } else if (!ɵselectThreadsIsLoading(initialState)) {
      this._threadsErrorByAgent.delete(agentId);
    }
    this.rebuildFlattenedThreads();
    this.autoSelectLatestThread();
  }

  private rebuildFlattenedThreads(): void {
    this._threads = flattenThreadsByAgent(this._threadsByAgent);
    this.scheduleInspectorUsageRefresh();
  }

  private scheduleInspectorUsageRefresh(): void {
    const signature = this._threads
      .map((thread) => thread.id)
      .sort()
      .join(",");
    if (signature === this.threadUsageSignature) {
      return;
    }
    this.threadUsageSignature = signature;
    if (this.threadUsageRefreshTimer !== null) {
      clearTimeout(this.threadUsageRefreshTimer);
    }
    this.threadUsageRefreshTimer = setTimeout(() => {
      this.threadUsageRefreshTimer = null;
      const core = this.core;
      if (core && typeof core.refreshInspectorMetadata === "function") {
        void core.refreshInspectorMetadata();
      }
    }, 300);
  }

  private clearInspectorUsageRefresh(): void {
    if (this.threadUsageRefreshTimer !== null) {
      clearTimeout(this.threadUsageRefreshTimer);
      this.threadUsageRefreshTimer = null;
    }
    this.threadUsageSignature = "";
  }

  private autoSelectLatestThread(): void {
    if (!this.areThreadEndpointsAvailable()) return;
    const { displayThreads } = this.getActiveThreadsState();
    const previousSelectedThreadId = this.selectedThreadId;

    if (this.requestedThreadId !== null) {
      this.selectedThreadId = this.requestedThreadId;
      this.selectedRealThreadIsExplicit = true;
      if (
        displayThreads.some((thread) => thread.id === this.requestedThreadId)
      ) {
        this.requestedThreadId = null;
      }
      return;
    }

    if (
      this.selectedLocalExampleThreadId !== null &&
      previousSelectedThreadId === this.selectedLocalExampleThreadId &&
      displayThreads.length === 0
    ) {
      this.selectedRealThreadIsExplicit = false;
      return;
    }

    if (this.selectedLocalExampleThreadId !== null) {
      this.exampleTourActive = false;
    }
    this.selectedLocalExampleThreadId = null;
    const explicitSelectedThreadId = this.selectedRealThreadIsExplicit
      ? previousSelectedThreadId
      : null;
    const nextSelectedThreadId = selectVisibleRealThreadId({
      threads: displayThreads,
      selectedThreadId: explicitSelectedThreadId,
    });
    this.selectedThreadId = nextSelectedThreadId;
    this.selectedRealThreadIsExplicit =
      explicitSelectedThreadId !== null &&
      nextSelectedThreadId === explicitSelectedThreadId;
  }

  private teardownThreadStoreSubscriptions(): void {
    for (const unsub of this._threadStoreSubscriptions.values()) {
      unsub();
    }
    this._threadStoreSubscriptions.clear();
    this._threadsByAgent.clear();
    this._threadsErrorByAgent.clear();
    this._threadsLoadingByAgent.clear();
    this._threads = [];
    this.clearInspectorUsageRefresh();
  }

  private ensureOwnedThreadStore(agentId: string): void {
    if (!this.areThreadEndpointsAvailable()) return;
    if (this._ownedThreadStores.has(agentId)) return;
    // Don't overwrite a store already registered by useThreads() or another external caller
    if (this.core?.getThreadStore(agentId)) return;
    const core = this.core;
    if (!core?.runtimeUrl) return;

    const runtimeFetch =
      typeof core.ɵruntimeFetch === "function"
        ? core.ɵruntimeFetch
        : globalThis.fetch;
    const store = ɵcreateThreadStore({ fetch: runtimeFetch });
    store.start();
    store.setContext({
      runtimeUrl: core.runtimeUrl,
      headers: { ...core.headers },
      wsUrl: core.intelligence?.wsUrl,
      agentId,
    });
    this._ownedThreadStores.set(agentId, store);
    // Subscribe directly so threads render even before the registry callback
    // fires (some published-core code paths land on the subscriber after
    // registerThreadStore returns).
    this.subscribeToThreadStore(agentId, store);
    core.registerThreadStore(agentId, store);
  }

  private refreshOwnedThreadStore(agentId: string): void {
    if (!this.areThreadEndpointsAvailable()) return;
    const store = this._ownedThreadStores.get(agentId);
    if (!store) return;

    const now = Date.now();
    const lastSentAt = this.threadRefreshLastSentAt.get(agentId) ?? 0;
    const waitMs = THREAD_LIST_DEBOUNCE_MS - (now - lastSentAt);
    if (waitMs <= 0) {
      this.sendOwnedThreadRefresh(agentId, store, now);
      return;
    }
    if (this.threadRefreshTrailingTimers.has(agentId)) return;
    this.threadRefreshTrailingTimers.set(
      agentId,
      setTimeout(() => {
        this.threadRefreshTrailingTimers.delete(agentId);
        const current = this._ownedThreadStores.get(agentId);
        if (!current) return;
        this.sendOwnedThreadRefresh(agentId, current, Date.now());
      }, waitMs),
    );
  }

  private sendOwnedThreadRefresh(
    agentId: string,
    store: ɵThreadStore,
    sentAt: number,
  ): void {
    this.threadRefreshLastSentAt.set(agentId, sentAt);
    // refresh() re-fetches without resetting threads to [] first, so the list
    // stays visible while new data loads and survives transient fetch failures.
    store.refresh();
  }

  private cancelThreadRefreshDebounce(): void {
    for (const timer of this.threadRefreshTrailingTimers.values()) {
      clearTimeout(timer);
    }
    this.threadRefreshTrailingTimers.clear();
  }

  // Keep inspector-owned thread stores in sync when the host updates headers
  // at runtime (e.g. a refreshed auth/CSRF token via core.setHeaders). Mirrors
  // useThreads(), which re-dispatches the context whenever core.headers change,
  // so the owned stores' /threads requests stay authorized.
  private updateOwnedThreadStoreHeaders(
    headers: Readonly<Record<string, string>>,
  ): void {
    if (!this.areThreadEndpointsAvailable()) return;
    const core = this.core;
    if (!core?.runtimeUrl) return;
    for (const [agentId, store] of this._ownedThreadStores) {
      store.setContext({
        runtimeUrl: core.runtimeUrl,
        headers: { ...headers },
        wsUrl: core.intelligence?.wsUrl,
        agentId,
      });
    }
  }

  private removeOwnedThreadStore(agentId: string): void {
    const store = this._ownedThreadStores.get(agentId);
    if (!store) return;
    this._ownedThreadStores.delete(agentId);
    store.stop();
    if (this.core?.getThreadStore(agentId) === store) {
      this.core.unregisterThreadStore(agentId);
    }
  }

  private teardownOwnedThreadStores(): void {
    const ownedThreadStores = Array.from(this._ownedThreadStores);
    this._ownedThreadStores.clear();
    for (const [agentId, store] of ownedThreadStores) {
      store.stop();
      if (this.core?.getThreadStore(agentId) === store) {
        this.core.unregisterThreadStore(agentId);
      }
    }
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
          this.threadCapabilityEnabled === true;
        this.synchronizeThreadCapability();
        if (status === "connected") {
          if (!core.telemetryDisabled) {
            ensureTelemetryDistinctId();
            maybeShowDisclosure();
          }
          this.flushPendingWhatsNewTelemetry();
          if (
            threadCapabilityWasEnabled &&
            this.areThreadEndpointsAvailable()
          ) {
            for (const agentId of this._ownedThreadStores.keys()) {
              this.refreshOwnedThreadStore(agentId);
            }
          }
        } else {
          // Clear stale thread data immediately when the server goes away
          this._threadsByAgent.clear();
          this._threads = [];
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
        this.contextStore = this.normalizeContextStore(context);
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
        const unsub = this._threadStoreSubscriptions.get(agentId);
        if (unsub) {
          unsub();
          this._threadStoreSubscriptions.delete(agentId);
        }
        if (this._ownedThreadStores.get(agentId) === prevStore) {
          this._ownedThreadStores.delete(agentId);
          prevStore.stop();
        }
        this._threadsByAgent.delete(agentId);
        this._threadsErrorByAgent.delete(agentId);
        this._threadsLoadingByAgent.delete(agentId);
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
      this.flushPendingWhatsNewTelemetry();
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
      this.contextStore = this.normalizeContextStore(core.context);
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
    // and is safe to call when already subscribed — `ensureMemorySubscription`
    // early-returns on `_memorySubscribed`.
    if (this.selectedMenu === "memories") {
      this.ensureMemorySubscription();
    }
  }

  /**
   * Lazily subscribes to the singleton memory store the first time the user
   * activates the Memories tab. This is deferred out of `attachToCore` because
   * `core.getMemoryStore()` is what creates + starts the store and opens
   * realtime — doing it on attach would start memory for apps that never use
   * it. Idempotent: repeated tab activations are guarded by
   * `_memorySubscribed`. On an older @copilotkit/core without `getMemoryStore`,
   * records the unsupported state so the teaser can guide an SDK upgrade.
   */
  private ensureMemorySubscription(): void {
    if (this._memorySubscribed) {
      return;
    }
    const core = this._core;
    if (!core) {
      return;
    }

    // Guard like getThreadStores: older @copilotkit/core has no getMemoryStore.
    // When absent, flag the unsupported state so the teaser shows upgrade copy
    // instead of throwing a TypeError that would break the entire inspector.
    if (typeof core.getMemoryStore !== "function") {
      this._memoryStoreUnsupported = true;
      this._memoriesAvailable = false;
      this.requestUpdate();
      return;
    }

    this._memorySubscribed = true;
    this._memoryStoreUnsupported = false;

    // First touch of getMemoryStore() — creates + starts the store, opens realtime.
    const memoryStore = core.getMemoryStore();
    const ms = memoryStore.getState();
    this._memories = ɵselectMemories(ms);
    this._memoriesLoading = ɵselectMemoriesIsLoading(ms);
    this._memoriesError = ɵselectMemoriesError(ms);
    this._memoriesAvailable = ɵselectMemoriesAvailable(ms);
    this._memoriesRealtimeStatus = ɵselectMemoriesRealtimeStatus(ms);
    const memSubs = [
      memoryStore.select(ɵselectMemories).subscribe((v) => {
        this._memories = v;
        this.requestUpdate();
      }),
      memoryStore.select(ɵselectMemoriesIsLoading).subscribe((v) => {
        this._memoriesLoading = v;
        this.requestUpdate();
      }),
      memoryStore.select(ɵselectMemoriesError).subscribe((v) => {
        this._memoriesError = v;
        if (v) {
          this.armEventError("memory", v.message);
        }
        this.requestUpdate();
      }),
      memoryStore.select(ɵselectMemoriesAvailable).subscribe((v) => {
        this._memoriesAvailable = v;
        this.requestUpdate();
      }),
      // Group E — realtime connection health.
      memoryStore.select(ɵselectMemoriesRealtimeStatus).subscribe((v) => {
        this._memoriesRealtimeStatus = v;
        this.requestUpdate();
      }),
    ];
    this._memoryUnsub = () => memSubs.forEach((s) => s.unsubscribe());
    this.requestUpdate();
  }

  /**
   * Runs a semantic recall via the memory store (`core.getMemoryStore().recall`,
   * from B2) and stores ranked results. Guarded by a monotonic sequence token
   * so a stale request cannot overwrite a newer result / Clear / detach. Only
   * reachable from the Intelligence-gated memory view, so it inherits the gate.
   */
  private runRecall(query: string): void {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    const store = this._core?.getMemoryStore?.();
    if (!store || typeof store.recall !== "function") {
      this._recallResults = [];
      this._recallError = "Recall is not supported by this SDK version.";
      this._recallLoading = false;
      this.requestUpdate();
      return;
    }

    const seq = ++this._recallSeq;
    this._recallLoading = true;
    this._recallError = null;
    this.requestUpdate();

    store
      .recall(trimmed)
      .then((results) => {
        if (seq !== this._recallSeq) return;
        this._recallResults = results;
        this._recallError = null;
        this._recallLoading = false;
        this.requestUpdate();
      })
      .catch((error: unknown) => {
        if (seq !== this._recallSeq) return;
        this._recallResults = [];
        this._recallError =
          error instanceof Error ? error.message : "unknown error";
        this._recallLoading = false;
        this.requestUpdate();
      });
  }

  /** Clears recall results/section and cancels any in-flight recall. */
  private clearRecall(): void {
    this._recallSeq += 1;
    this._recallResults = null;
    this._recallError = null;
    this._recallLoading = false;
    this._recallQuery = "";
    this.requestUpdate();
  }

  private detachFromCore(): void {
    this.threadCapabilityGeneration += 1;
    this.threadCapabilityEnabled = null;
    if (this.selectedThreadId !== this.selectedLocalExampleThreadId) {
      this.selectedThreadId = null;
      this.selectedLocalExampleThreadId = null;
    }
    this.selectedRealThreadIsExplicit = false;
    if (this.coreUnsubscribe) {
      this.coreUnsubscribe();
      this.coreUnsubscribe = null;
    }
    this._memoryUnsub?.();
    this._memoryUnsub = null;
    this._memories = [];
    this._memoriesLoading = false;
    this._memoriesError = null;
    this._memoriesAvailable = true;
    this._memoriesRealtimeStatus = "connecting";
    // Reset the lazy-subscription guards so a later attach + Memories-tab
    // activation re-subscribes (and re-evaluates SDK support) cleanly.
    this._memorySubscribed = false;
    this._memoryStoreUnsupported = false;
    // Reset recall state and bump the sequence token so any in-flight recall
    // resolving after detach is ignored.
    this._recallSeq += 1;
    this._recallResults = null;
    this._recallLoading = false;
    this._recallError = null;
    this._recallQuery = "";
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
    for (const unsubscribe of this.agentSubscriptions.values()) {
      unsubscribe();
    }
    this.agentSubscriptions.clear();
    this.agentEvents.clear();
    this.agentMessages.clear();
    this.agentStates.clear();
    this.flattenedEvents = [];
    this.eventCounter = 0;
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
    if (!this._core) {
      if (this.cachedTools.length > 0) {
        this.cachedTools = [];
        this.toolSignature = "";
        this.requestUpdate();
      }
      return;
    }

    const tools = this.extractToolsFromAgents();
    const signature = JSON.stringify(
      tools.map((tool) => ({
        agentId: tool.agentId,
        name: tool.name,
        type: tool.type,
        hasDescription: Boolean(tool.description),
        hasParameters: Boolean(tool.parameters),
      })),
    );

    if (signature !== this.toolSignature) {
      this.toolSignature = signature;
      this.cachedTools = tools;
      this.requestUpdate();
    }
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
    if (!agent.agentId) {
      return;
    }

    const agentId = agent.agentId;

    this.unsubscribeFromAgent(agentId);

    const subscriber: AgentSubscriber = {
      onRunStartedEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "RUN_STARTED", event);
      },
      onRunFinishedEvent: (params) => {
        this.recordAgentEvent(agentId, "RUN_FINISHED", {
          event: params.event,
          result: "result" in params ? params.result : undefined,
        });
        if (this.areThreadEndpointsAvailable()) {
          this.refreshOwnedThreadStore(agentId);
        }
      },
      onRunErrorEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "RUN_ERROR", event);
      },
      onStepStartedEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "STEP_STARTED", event);
      },
      onStepFinishedEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "STEP_FINISHED", event);
      },
      onTextMessageStartEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "TEXT_MESSAGE_START", event);
      },
      onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
        this.recordAgentEvent(agentId, "TEXT_MESSAGE_CONTENT", {
          event,
          textMessageBuffer,
        });
      },
      onTextMessageEndEvent: ({ event, textMessageBuffer }) => {
        this.recordAgentEvent(agentId, "TEXT_MESSAGE_END", {
          event,
          textMessageBuffer,
        });
      },
      onToolCallStartEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_START", event);
      },
      onToolCallArgsEvent: ({
        event,
        toolCallBuffer,
        toolCallName,
        partialToolCallArgs,
      }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_ARGS", {
          event,
          toolCallBuffer,
          toolCallName,
          partialToolCallArgs,
        });
      },
      onToolCallEndEvent: ({ event, toolCallArgs, toolCallName }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_END", {
          event,
          toolCallArgs,
          toolCallName,
        });
      },
      onToolCallResultEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_RESULT", event);
      },
      onStateSnapshotEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "STATE_SNAPSHOT", event);
        this.syncAgentState(agent);
      },
      onStateDeltaEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "STATE_DELTA", event);
        this.syncAgentState(agent);
      },
      onMessagesSnapshotEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "MESSAGES_SNAPSHOT", event);
        this.syncAgentMessages(agent);
      },
      onMessagesChanged: () => {
        this.syncAgentMessages(agent);
      },
      onStateChanged: () => {
        this.syncAgentState(agent);
      },
      onRawEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "RAW_EVENT", event);
      },
      onCustomEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "CUSTOM_EVENT", event);
      },
      onReasoningStartEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "REASONING_START", event);
      },
      onReasoningMessageStartEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "REASONING_MESSAGE_START", event);
      },
      onReasoningMessageContentEvent: ({ event, reasoningMessageBuffer }) => {
        this.recordAgentEvent(agentId, "REASONING_MESSAGE_CONTENT", {
          event,
          reasoningMessageBuffer,
        });
      },
      onReasoningMessageEndEvent: ({ event, reasoningMessageBuffer }) => {
        this.recordAgentEvent(agentId, "REASONING_MESSAGE_END", {
          event,
          reasoningMessageBuffer,
        });
      },
      onReasoningEndEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "REASONING_END", event);
      },
      onReasoningEncryptedValueEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "REASONING_ENCRYPTED_VALUE", event);
      },
      onActivitySnapshotEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "ACTIVITY_SNAPSHOT", event);
        this.syncAgentMessages(agent);
      },
      onActivityDeltaEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "ACTIVITY_DELTA", event);
        this.syncAgentMessages(agent);
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    this.agentSubscriptions.set(agentId, unsubscribe);
    this.syncAgentMessages(agent);
    this.syncAgentState(agent);

    if (!this.agentEvents.has(agentId)) {
      this.agentEvents.set(agentId, []);
    }
  }

  private unsubscribeFromAgent(agentId: string): void {
    const unsubscribe = this.agentSubscriptions.get(agentId);
    if (unsubscribe) {
      unsubscribe();
      this.agentSubscriptions.delete(agentId);
    }
  }

  private mapMessagesToConversation(
    messages: InspectorMessage[] | null,
  ): { id: string; type: string; content: string; createdAt: string }[] | null {
    if (!messages) return null;
    return messages
      .filter(
        (m) =>
          m.role === "user" || m.role === "assistant" || m.role === "activity",
      )
      .map((m, i) => ({
        id: m.id ?? `msg-${i}`,
        type:
          m.role === "user"
            ? "user"
            : m.role === "activity"
              ? "generative-ui"
              : "assistant",
        // For activity messages, store the activityType as a label so the
        // renderer has something meaningful to display.
        // TODO: render activity payload once available.
        content:
          m.role === "activity" ? (m.activityType ?? "unknown") : m.contentText,
        createdAt: "",
      }));
  }

  private recordAgentEvent(
    agentId: string,
    type: InspectorAgentEventType,
    payload: unknown,
  ): void {
    const eventId = `${agentId}:${++this.eventCounter}`;
    const normalizedPayload = this.normalizeEventPayload(type, payload);
    const event: InspectorEvent = {
      id: eventId,
      agentId,
      type,
      timestamp: Date.now(),
      payload: normalizedPayload,
    };

    const currentAgentEvents = this.agentEvents.get(agentId) ?? [];
    const nextAgentEvents = [event, ...currentAgentEvents].slice(
      0,
      MAX_AGENT_EVENTS,
    );
    this.agentEvents.set(agentId, nextAgentEvents);

    this.flattenedEvents = [event, ...this.flattenedEvents].slice(
      0,
      MAX_TOTAL_EVENTS,
    );
    this.refreshToolsSnapshot();
    this.requestUpdate();
  }

  private syncAgentMessages(agent: AbstractAgent): void {
    if (!agent?.agentId) {
      return;
    }

    try {
      const messages = this.normalizeAgentMessages(
        (agent as { messages?: unknown }).messages,
      );
      if (messages) {
        this.agentMessages.set(agent.agentId, messages);
      } else {
        this.agentMessages.delete(agent.agentId);
      }

      // Bump the live-message version for whichever thread this agent is
      // currently running on. cpk-thread-details watches this for the
      // selected thread and re-fetches `/threads/:id/messages` when it ticks,
      // so the conversation view stays in sync with the streaming agent
      // without the parent re-implementing AG-UI → ConversationItem mapping.
      const runThreadId = (agent as { threadId?: string }).threadId;
      if (runThreadId) {
        this.liveMessageVersion.set(
          runThreadId,
          (this.liveMessageVersion.get(runThreadId) ?? 0) + 1,
        );
      }

      this.requestUpdate();
    } catch (error) {
      console.error(
        `[CopilotKit Inspector] Failed to sync messages for agent "${agent.agentId}":`,
        error,
      );
    }
  }

  private syncAgentState(agent: AbstractAgent): void {
    if (!agent?.agentId) {
      return;
    }

    try {
      const state = (agent as { state?: unknown }).state;

      if (state === undefined || state === null) {
        this.agentStates.delete(agent.agentId);
      } else {
        this.agentStates.set(agent.agentId, this.sanitizeForLogging(state));
      }

      this.requestUpdate();
    } catch (error) {
      console.error(
        `[CopilotKit Inspector] Failed to sync state for agent "${agent.agentId}":`,
        error,
      );
    }
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

  private getEventsForSelectedContext(): InspectorEvent[] {
    if (this.selectedContext === "all-agents") {
      return this.flattenedEvents;
    }

    return this.agentEvents.get(this.selectedContext) ?? [];
  }

  private focusThread(options: InspectorOpenOptions): void {
    if (!options.threadId) return;
    this.pendingPersistedMenu = null;
    this.selectedMenu = "threads";
    this.settingsOpen = false;
    this.lastSelectedMenuByGroup.workbench = "threads";
    this.contextMenuOpen = false;
    this.layoutMenuOpen = false;
    this.selectedLocalExampleThreadId = null;
    this.exampleTourActive = false;
    this.selectedContext =
      options.agentId &&
      this.contextOptions.some((option) => option.key === options.agentId)
        ? options.agentId
        : "all-agents";
    this.requestedThreadId = options.threadId;
    this.selectedThreadId = options.threadId;
    this.selectedRealThreadIsExplicit = true;
    this.focusedThreadMessageId = options.messageId ?? null;
    this.threadFocusRequestId += 1;

    const { displayThreads } = this.getActiveThreadsState();
    if (displayThreads.some((thread) => thread.id === options.threadId)) {
      this.requestedThreadId = null;
    }

    this.persistState();
    this.requestUpdate();
  }

  private filterEvents(events: InspectorEvent[]): InspectorEvent[] {
    const query = this.eventFilterText.trim().toLowerCase();

    return events.filter((event) => {
      if (
        this.eventTypeFilter !== "all" &&
        event.type !== this.eventTypeFilter
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const payloadText = this.stringifyPayload(
        event.payload,
        false,
      ).toLowerCase();
      return (
        event.type.toLowerCase().includes(query) ||
        event.agentId.toLowerCase().includes(query) ||
        payloadText.includes(query)
      );
    });
  }

  private getLatestStateForAgent(agentId: string): SanitizedValue | null {
    if (this.agentStates.has(agentId)) {
      const value = this.agentStates.get(agentId);
      return value === undefined ? null : value;
    }

    const events = this.agentEvents.get(agentId) ?? [];
    const stateEvent = events.find((e) => e.type === "STATE_SNAPSHOT");
    if (!stateEvent) {
      return null;
    }
    return stateEvent.payload;
  }

  private getLatestMessagesForAgent(
    agentId: string,
  ): InspectorMessage[] | null {
    const messages = this.agentMessages.get(agentId);
    return messages ?? null;
  }

  private getAgentStatus(agentId: string): "running" | "idle" | "error" {
    const events = this.agentEvents.get(agentId) ?? [];
    if (events.length === 0) {
      return "idle";
    }

    // Check most recent run-related event
    const runEvent = events.find(
      (e) =>
        e.type === "RUN_STARTED" ||
        e.type === "RUN_FINISHED" ||
        e.type === "RUN_ERROR",
    );

    if (!runEvent) {
      return "idle";
    }

    if (runEvent.type === "RUN_ERROR") {
      return "error";
    }

    if (runEvent.type === "RUN_STARTED") {
      // Check if there's a RUN_FINISHED after this
      const finishedAfter = events.find(
        (e) => e.type === "RUN_FINISHED" && e.timestamp > runEvent.timestamp,
      );
      return finishedAfter ? "idle" : "running";
    }

    return "idle";
  }

  private getAgentStats(agentId: string): {
    totalEvents: number;
    lastActivity: number | null;
    messages: number;
    toolCalls: number;
    errors: number;
  } {
    const events = this.agentEvents.get(agentId) ?? [];

    const messages = this.agentMessages.get(agentId);

    const toolCallCount = messages
      ? messages.reduce(
          (count, message) => count + (message.toolCalls?.length ?? 0),
          0,
        )
      : events.filter((e) => e.type === "TOOL_CALL_END").length;

    const messageCount = messages?.length ?? 0;

    return {
      totalEvents: events.length,
      lastActivity: events[0]?.timestamp ?? null,
      messages: messageCount,
      toolCalls: toolCallCount,
      errors: events.filter((e) => e.type === "RUN_ERROR").length,
    };
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
            call.function?.arguments,
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
                  ? html`<p class="mt-2 break-words leading-relaxed text-gray-800">
                    ${toolError.message}
                  </p>`
                  : nothing
              }
              ${
                argsString
                  ? html`<pre
                    class="mt-2 overflow-auto rounded bg-white p-2 text-[11px] leading-relaxed text-gray-800"
                  >
${argsString}</pre
                  >`
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

  private hasRenderableState(state: unknown): boolean {
    if (state === null || state === undefined) {
      return false;
    }

    if (Array.isArray(state)) {
      return state.length > 0;
    }

    if (typeof state === "object") {
      return Object.keys(state as Record<string, unknown>).length > 0;
    }

    if (typeof state === "string") {
      const trimmed = state.trim();
      return trimmed.length > 0 && trimmed !== "{}";
    }

    return true;
  }

  private formatStateForDisplay(state: unknown): string {
    if (state === null || state === undefined) {
      return "";
    }

    if (typeof state === "string") {
      const trimmed = state.trim();
      if (trimmed.length === 0) {
        return "";
      }
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return state;
      }
    }

    if (typeof state === "object") {
      try {
        return JSON.stringify(state, null, 2);
      } catch {
        return String(state);
      }
    }

    return String(state);
  }

  private getEventBadgeClasses(type: string): string {
    const base =
      "font-mono text-[10px] font-medium inline-flex items-center rounded-sm px-1.5 py-0.5 border";

    if (type === "RUN_ERROR") {
      return `${base} bg-rose-50 text-rose-700 border-rose-200`;
    }

    if (type.startsWith("RUN_")) {
      return `${base} bg-blue-50 text-blue-700 border-blue-200`;
    }

    if (type.startsWith("TEXT_MESSAGE")) {
      return `${base} bg-emerald-50 text-emerald-700 border-emerald-200`;
    }

    if (type.startsWith("TOOL_CALL")) {
      return `${base} bg-amber-50 text-amber-700 border-amber-200`;
    }

    if (type.startsWith("REASONING")) {
      return `${base} bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200`;
    }

    if (type.startsWith("STATE")) {
      return `${base} bg-violet-50 text-violet-700 border-violet-200`;
    }

    if (type.startsWith("MESSAGES")) {
      return `${base} bg-sky-50 text-sky-700 border-sky-200`;
    }

    return `${base} bg-gray-100 text-gray-600 border-gray-200`;
  }

  private stringifyPayload(payload: unknown, pretty: boolean): string {
    try {
      if (payload === undefined) {
        return pretty ? "undefined" : "undefined";
      }
      if (typeof payload === "string") {
        return payload;
      }
      return JSON.stringify(payload, null, pretty ? 2 : 0) ?? "";
    } catch (error) {
      console.warn("Failed to stringify inspector payload", error);
      return String(payload);
    }
  }

  private extractEventFromPayload(payload: unknown): unknown {
    // If payload is an object with an 'event' field, extract it
    if (payload && typeof payload === "object" && "event" in payload) {
      return (payload as Record<string, unknown>).event;
    }
    // Otherwise, assume the payload itself is the event
    return payload;
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

  private async copyToClipboard(
    text: string,
    eventId: string,
    event?: Event,
  ): Promise<void> {
    const clipboard = this.getClipboard(event);
    if (!clipboard) {
      console.error(
        "Failed to copy to clipboard:",
        "Clipboard API is not available",
      );
      return;
    }
    try {
      await clipboard.writeText(text);
      this.copiedEvents.add(eventId);
      this.requestUpdate();

      // Clear the "copied" state after 2 seconds
      setTimeout(() => {
        this.copiedEvents.delete(eventId);
        this.requestUpdate();
      }, 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  }

  static styles = [
    unsafeCSS(tailwindStyles),
    css`
      :host {
        --cpk-inspector-shell-radius: 5px;
        --cpk-inspector-surface-dark: #111319;
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483646;
        display: block;
        will-change: transform;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
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

      /* ── Agent tab section cards ─────────────────────────────────────── */
      .cpk-section-card {
        border-radius: 10px;
        background: #ffffff;
        overflow: hidden;
      }

      /* ── Agent icon bubble ───────────────────────────────────────────── */
      .cpk-agent-icon {
        background-color: #f0f0f4 !important;
        color: #57575b !important;
      }

      /* ── Agent stat cards ────────────────────────────────────────────── */
      .cpk-stat-card {
        background-color: #ffffff !important;
        border: 1px solid #dbdbe5 !important;
      }
      button.cpk-stat-card:hover {
        background-color: #f7f7f9 !important;
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
        font-size: 10px;
        font-weight: 500;
        color: #57575b;
        background: #ffffff;
        border: 1px solid #dbdbe5;
        cursor: pointer;
        padding: 2px 8px;
        border-radius: 5px;
        flex-shrink: 0;
        transition:
          background-color 0.15s,
          border-color 0.15s;
      }
      .cpk-copy-btn:hover {
        background-color: #f0f0f4;
        border-color: #afafb7;
      }

      .cpk-section-header {
        background: #e8edf5;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        padding: 10px 16px;
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

      .announcement-content {
        color: #1f2230;
        font-size: 13px;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        line-height: 1.55;
      }

      .announcement-content h1,
      .announcement-content h2,
      .announcement-content h3 {
        color: #010507;
        font-weight: 700;
        line-height: 1.3;
        margin: 0.9rem 0 0.4rem;
      }
      .announcement-content > h1:first-child,
      .announcement-content > h2:first-child,
      .announcement-content > h3:first-child {
        margin-top: 0;
      }

      .announcement-content h1 {
        font-size: 1.15rem;
        letter-spacing: -0.01em;
      }
      .announcement-content h2 {
        font-size: 1rem;
      }
      .announcement-content h3 {
        font-size: 0.9rem;
        text-transform: none;
      }

      .announcement-content p {
        margin: 0.45rem 0;
      }

      .announcement-content strong {
        color: #010507;
        font-weight: 700;
      }

      .announcement-content ul {
        list-style: disc;
        padding-left: 1.25rem;
        margin: 0.45rem 0;
      }

      .announcement-content ol {
        list-style: decimal;
        padding-left: 1.25rem;
        margin: 0.45rem 0;
      }

      .announcement-content li + li {
        margin-top: 0.15rem;
      }

      .announcement-content a {
        color: #5558b2;
        text-decoration: underline;
      }

      .announcement-content :not(pre) > code {
        background: #f3f3f7;
        border: 1px solid #e4e4ec;
        border-radius: 5px;
        padding: 1px 5px;
        font-size: 0.85em;
        color: #4a3a8a;
      }

      .announcement-code {
        position: relative;
        margin: 0.6rem 0;
      }

      .announcement-code pre {
        background: #0f1117;
        color: #e6e8f2;
        border-radius: 10px;
        padding: 10px 12px;
        overflow-x: auto;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre;
      }

      .announcement-code pre code::after {
        content: "";
        display: inline-block;
        width: 80px;
      }

      .announcement-code__copy-shield {
        position: absolute;
        top: 4px;
        right: 4px;
        padding: 4px 4px 4px 24px;
        border-top-right-radius: 10px;
        background: linear-gradient(
          to right,
          rgba(15, 17, 23, 0) 0%,
          rgba(15, 17, 23, 0.95) 40%,
          #0f1117 100%
        );
        pointer-events: none;
      }

      .announcement-code pre code {
        background: transparent;
        border: none;
        padding: 0;
        color: inherit;
        font-size: inherit;
      }

      .announcement-code pre::-webkit-scrollbar {
        height: 6px;
      }
      .announcement-code pre::-webkit-scrollbar-track {
        background: transparent;
      }
      .announcement-code pre::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }

      .announcement-code__copy {
        position: relative;
        pointer-events: auto;
        padding: 3px 8px;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 11px;
        font-weight: 600;
        color: #e6e8f2;
        background: #1f222d;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        cursor: pointer;
        transition:
          background 0.12s ease,
          color 0.12s ease;
      }
      .announcement-code__copy:hover {
        background: #2a2e3c;
      }
      .announcement-code__copy[data-copied="true"] {
        background: #eee6fe;
        color: #6430ab;
        border-color: transparent;
      }

      /* ── What's new ──────────────────────────────────────────────── */
      .whats-new {
        display: block;
        padding: 16px;
      }

      .whats-new__heading {
        margin: 0 0 10px;
        color: #010507;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
        letter-spacing: -0.01em;
      }

      .whats-new__status {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #57575b;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 13px;
      }

      .whats-new__status-icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: #eee6fe;
        color: #5558b2;
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
      }

      /* ── Launcher HUD: hover menu, quieter than the error island ── */
      .console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-hud {
        pointer-events: auto;
        opacity: 1;
        transform: none;
        visibility: visible;
      }

      .cpk-launcher-hud {
        position: absolute;
        top: 0;
        z-index: 4;
        padding-right: 14px;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transform: translateX(8px);
        transition:
          opacity 160ms ease,
          transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }

      .cpk-launcher-hud[data-cpk-hud-side="left"] {
        right: 100%;
        padding-right: 14px;
        padding-left: 0;
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"] {
        left: 100%;
        right: auto;
        padding-right: 0;
        padding-left: 14px;
        transform: translateX(-8px);
      }

      .console-button-wrapper[data-cpk-hud="open"]
        .cpk-launcher-hud[data-cpk-hud-side="right"] {
        transform: none;
      }

      .cpk-launcher-hud__card {
        --hud-fill: var(--cpk-inspector-surface-dark);
        --hud-line: rgb(190 194 255 / 0.5);
        position: relative;
        width: 228px;
        padding: 4px;
        border: 1px dotted var(--hud-line);
        border-radius: var(--cpk-inspector-shell-radius);
        background: var(--hud-fill);
        color: #fff;
        backdrop-filter: blur(12px) saturate(1.2);
        box-shadow: 0 8px 20px rgb(1 5 7 / 0.18);
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__card {
        --hud-fill: #fff;
        --hud-line: #d8d8e8;
        color: #010507;
      }

      .cpk-launcher-hud__arrow {
        position: absolute;
        top: calc(var(--cpk-launcher-size) / 2);
        width: 10px;
        height: 10px;
        background: var(--hud-fill);
        transform: translateY(-50%) rotate(45deg);
      }

      .cpk-launcher-hud[data-cpk-hud-side="left"] .cpk-launcher-hud__arrow {
        right: -5px;
        border-top: 1px solid var(--hud-line);
        border-right: 1px solid var(--hud-line);
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"] .cpk-launcher-hud__arrow {
        left: -5px;
        border-bottom: 1px solid var(--hud-line);
        border-left: 1px solid var(--hud-line);
      }

      .cpk-launcher-hud__list {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .cpk-launcher-hud__list + .cpk-launcher-hud__list {
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px dotted var(--hud-line);
      }

      .cpk-launcher-hud__row {
        position: relative;
        display: grid;
        grid-template-columns: 1fr 28px;
        align-items: start;
        border-radius: 7px;
        cursor: pointer;
      }

      .cpk-launcher-hud__row + .cpk-launcher-hud__row {
        margin-top: 1px;
      }

      .cpk-launcher-hud__row:hover,
      .cpk-launcher-hud__row:focus-within,
      .cpk-launcher-hud__row[data-cpk-hud-help="open"] {
        background: rgb(255 255 255 / 0.06);
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row:hover,
      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row:focus-within,
      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row[data-cpk-hud-help="open"] {
        background: #f0f0f4;
      }

      .cpk-launcher-hud__action {
        display: flex;
        gap: 8px;
        min-height: 32px;
        align-items: center;
        padding: 6px 8px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #fff;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        text-align: start;
        cursor: pointer;
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__action {
        color: #010507;
      }

      /* Stretch the row action over the whole tab, including the detail
         copy. The help mark sits above this layer. */
      .cpk-launcher-hud__action::after {
        content: "";
        position: absolute;
        inset: 0;
      }

      .cpk-launcher-hud__check {
        flex: none;
        width: 14px;
        height: 14px;
        color: #34d399;
      }

      .cpk-launcher-hud__help {
        position: relative;
        z-index: 1;
        display: inline-flex;
        width: 28px;
        height: 32px;
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

      .cpk-launcher-hud__help span {
        display: inline-flex;
        width: 16px;
        height: 16px;
        align-items: center;
        justify-content: center;
        border: 1px dotted rgb(190 194 255 / 0.55);
        border-radius: 50%;
        line-height: 1;
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__help {
        color: #68686e;
      }

      .cpk-launcher-hud__help:focus-visible,
      .cpk-launcher-hud__action:focus-visible {
        outline: 2px solid #bec2ff;
        outline-offset: 1px;
      }

      .cpk-launcher-hud__detail {
        grid-column: 1 / -1;
        max-height: 0;
        margin: 0;
        padding: 0 8px;
        overflow: hidden;
        color: rgb(255 255 255 / 0.78);
        font-size: 11px;
        font-weight: 400;
        line-height: 1.4;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-6px);
        transition:
          max-height 200ms cubic-bezier(0.16, 1, 0.3, 1),
          opacity 150ms ease-out,
          transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
          padding-bottom 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__detail {
        color: #68686e;
      }

      .cpk-launcher-hud__row:hover .cpk-launcher-hud__detail,
      .cpk-launcher-hud__row:focus-within .cpk-launcher-hud__detail,
      .cpk-launcher-hud__row[data-cpk-hud-help="open"] .cpk-launcher-hud__detail {
        max-height: 72px;
        padding: 0 8px 7px;
        opacity: 1;
        transform: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .cpk-launcher-hud,
        .cpk-launcher-hud__detail {
          transition: none;
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
        background: linear-gradient(
          90deg,
          #ffffff 0%,
          #f3f1ff 58%,
          #eefbf7 100%
        ) !important;
        color: #010507 !important;
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
      .cpk-threads-overview-video-frame {
        position: relative;
        display: block;
        width: 100%;
        max-width: 440px;
        aspect-ratio: 16 / 9;
        margin: 0 0 14px;
        overflow: hidden;
        border: 1px solid #dbdbe5;
        border-radius: 10px;
        background:
          linear-gradient(
            135deg,
            rgba(190, 194, 255, 0.18),
            rgba(133, 236, 206, 0.12)
          ),
          #ffffff;
        box-shadow: 0 8px 20px rgba(1, 5, 7, 0.08);
      }
      .cpk-threads-overview-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
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
        justify-content: center !important;
        align-items: center !important;
        gap: 0 !important;
        padding-inline: 0 !important;
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
  ];

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof window !== "undefined") {
      this.accountCtaMotionPaused = document.visibilityState !== "visible";
      this.threadsExampleOverviewVideoReducedMotion =
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
      this.subscribeToSystemColorScheme();
      this.exampleTourDismissed = this.readThreadsExampleTourDismissed();
      // The superseded, origin-scoped read state is discarded rather than
      // migrated: every existing user is re-armed exactly once so they
      // discover the surface that replaced the announcement bubble. Deleting
      // the key rather than leaving it means nothing can fall back to it.
      clearLegacyAnnouncementReadState();
      this.tryAutoAttachCore();
      this.ensureAnnouncementLoading();
      this.subscribeToInspectorThreadBridge();
    }
    this.requestUpdate();
  }

  private ensureBrandFonts(): void {
    ensureBrandFont(document);
  }

  private handleDocumentVisibilityChange = (): void => {
    this.accountCtaMotionPaused = document.visibilityState !== "visible";
    // Flush point for defer reason 2: somebody is looking again.
    if (document.visibilityState === "visible" && !this.isOpen) {
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
    this.unsubscribeFromInspectorThreadBridge();
    this.threadsSetupPromptCopyGeneration += 1;
    if (this.threadsSetupPromptCopyResetTimeoutId !== null) {
      window.clearTimeout(this.threadsSetupPromptCopyResetTimeoutId);
      this.threadsSetupPromptCopyResetTimeoutId = null;
    }
    this.threadsSetupPromptCopyState = "idle";
    this.stopSignalPulse();
    this.cancelGestureTail();
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

    this.ensureAnnouncementLoading();

    this.updateHostTransform(this.isOpen ? "window" : "button");
  }

  render() {
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
      "transition",
      "hover:scale-105",
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
          title=${
            // Visible text, so it is offered for the announcement only. No
            // error detail is rendered over the host application: a developer
            // who ships the Inspector to production must not leak internal
            // failure detail to their end users.
            activeSignal === NEWS_SIGNAL_ID
              ? `${WHATS_NEW_VIEW_LABEL} — unread`
              : nothing
          }
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
            // hover hint and the accessible name, and an unread announcement
            // is announced by its navigation entry, which is where a keyboard
            // user arrives.
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

  private isLauncherHudBlocked(): boolean {
    return this.gestureSignal !== null;
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
    if (this.launcherHudCloseTimer !== null) {
      clearTimeout(this.launcherHudCloseTimer);
      this.launcherHudCloseTimer = null;
    }
    if (!this.launcherHudOpen && this.launcherHudHelp === null) return;
    this.launcherHudOpen = false;
    this.launcherHudHelp = null;
    this.requestUpdate();
  }

  private handleLauncherHudEnter = (): void => {
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
      row === "inspector"
        ? null
        : row === "threads"
          ? "threads"
          : row === "learning"
            ? "memories"
            : "home";
    this.closeLauncherHud();
    this.openInspector("floating_button");
  };

  private handleHudHelpClick = (event: Event, row: LauncherHudRowId): void => {
    event.preventDefault();
    event.stopPropagation();
    this.launcherHudHelp = this.launcherHudHelp === row ? null : row;
    this.requestUpdate();
  };

  private handleHudRowClick = (event: Event, row: LauncherHudRowId): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".cpk-launcher-hud__help, [data-cpk-hud-action]")
    ) {
      return;
    }
    this.handleHudActionClick(event, row);
  };

  private renderHudCheck(): TemplateResult {
    return html`
      <svg
        class="cpk-launcher-hud__check"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
        data-cpk-hud-check
      >
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M3 8.5 6.5 12 13 4.5"
        />
      </svg>
    `;
  }

  private renderHudRow(args: {
    id: LauncherHudRowId;
    label: string;
    detail: string;
    connected?: boolean;
  }): TemplateResult {
    const helpOpen = this.launcherHudHelp === args.id;
    const detailId = `cpk-hud-detail-${args.id}`;
    return html`
      <li
        class="cpk-launcher-hud__row"
        data-cpk-hud-row=${args.id}
        data-cpk-hud-help=${helpOpen ? "open" : nothing}
        @click=${(event: Event) => this.handleHudRowClick(event, args.id)}
      >
        <button
          type="button"
          class="cpk-launcher-hud__action"
          data-cpk-hud-action
          aria-describedby=${detailId}
          @click=${(event: Event) => this.handleHudActionClick(event, args.id)}
          @pointerdown=${(event: Event) => event.stopPropagation()}
        >
          ${args.connected ? this.renderHudCheck() : nothing}${args.label}
        </button>
        <button
          type="button"
          class="cpk-launcher-hud__help"
          aria-expanded=${helpOpen ? "true" : "false"}
          aria-controls=${detailId}
          aria-label=${`About ${args.label}`}
          @click=${(event: Event) => this.handleHudHelpClick(event, args.id)}
          @pointerdown=${(event: Event) => event.stopPropagation()}
        >
          <span aria-hidden="true">?</span>
        </button>
        <p class="cpk-launcher-hud__detail" id=${detailId}>${args.detail}</p>
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
    const intelligenceOn = homeModel.hero.connection === "connected";
    return html`
      <div
        class="cpk-launcher-hud"
        id="cpk-launcher-hud"
        data-cpk-launcher-hud
        data-cpk-hud-side=${this.launcherHudSide}
        data-color-scheme=${this.colorScheme}
      >
        <div class="cpk-launcher-hud__card">
          <span class="cpk-launcher-hud__arrow" aria-hidden="true"></span>
          <ul class="cpk-launcher-hud__list" role="list">
            ${this.renderHudRow({
              id: "inspector",
              label: HUD_OPEN_INSPECTOR_LABEL,
              detail: HUD_OPEN_INSPECTOR_DETAIL,
            })}
          </ul>
          <ul class="cpk-launcher-hud__list" role="list">
            ${this.renderHudRow({
              id: "threads",
              label: threadsOn ? HUD_THREADS_ON_LABEL : HUD_THREADS_OFF_LABEL,
              detail: threadsOn
                ? HUD_THREADS_ON_DETAIL
                : HUD_THREADS_OFF_DETAIL,
              connected: threadsOn,
            })}
            ${this.renderHudRow({
              id: "intelligence",
              label: intelligenceOn
                ? HUD_INTELLIGENCE_ON_LABEL
                : HUD_INTELLIGENCE_OFF_LABEL,
              detail: intelligenceOn
                ? HUD_INTELLIGENCE_ON_DETAIL
                : HUD_INTELLIGENCE_OFF_DETAIL,
              connected: intelligenceOn,
            })}
            ${this.renderHudRow({
              id: "learning",
              label: learningOn
                ? HUD_LEARNING_ON_LABEL
                : HUD_LEARNING_OFF_LABEL,
              detail: learningOn
                ? HUD_LEARNING_ON_DETAIL
                : HUD_LEARNING_OFF_DETAIL,
              connected: learningOn,
            })}
          </ul>
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
              <button
                type="button"
                class="inspector-sidebar-toggle"
                data-inspector-sidebar-toggle
                aria-label=${iconRail ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded=${iconRail ? "false" : "true"}
                data-inspector-tooltip=${iconRail ? "Expand sidebar" : nothing}
                title=${iconRail ? nothing : "Collapse sidebar"}
                style=${INTERACTIVE_FOCUS_BASE_STYLE}
                @pointerenter=${
                  iconRail ? this.handleSidebarRailTooltipShow : nothing
                }
                @pointerleave=${
                  iconRail ? this.handleSidebarRailTooltipHide : nothing
                }
                @focus=${iconRail ? this.handleSidebarRailTooltipShow : nothing}
                @blur=${iconRail ? this.handleSidebarRailTooltipHide : nothing}
                @click=${this.handleSidebarToggle}
              >
                <span class="inspector-nav-icon" aria-hidden="true">
                  ${this.renderIcon(iconRail ? "ChevronRight" : "ChevronLeft")}
                </span>
                <span class="inspector-nav-label"
                  >${iconRail ? "Expand" : "Collapse"}</span
                >
              </button>
            `
        }
        ${
          iconRail
            ? nothing
            : html`
              <div class="inspector-sidebar-footer">
                <div class="inspector-sidebar-status-list">
                  ${this.renderSidebarIntelligenceStatus(homeModel)}
                </div>
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
      memoriesOn: this._memoriesAvailable,
      a2uiOn: this._core?.a2uiEnabled === true,
      openGenUiOn: this._core?.openGenerativeUIEnabled === true,
      suggestionsOn: this._core?.suggestions === true,
      audioOn: this._core?.audioFileTranscriptionEnabled === true,
      websocketUrl: this._core?.intelligence?.wsUrl,
      announcementPreviewText: this.announcementPreviewText ?? undefined,
      announcementMarkdown: this.announcementMarkdown ?? undefined,
      announcementHtml: this.announcementHtml ?? undefined,
      intelligenceSignupUrl: this.getIntelligenceSignupUrl(),
    });
  }

  private renderHomeView() {
    const model = this.getHomeModel();
    const connected = model.hero.connection === "connected";
    return html`
      <div
        class="inspector-home"
        data-inspector-home
        data-inspector-home-state=${connected ? "connected" : "disconnected"}
      >
        ${this.renderHomeWhatsNewPreview(model.news)}
        ${this.renderHomeSystemHealth(model)}
        ${this.renderHomeIntelligenceHud(model)}
        ${this.renderHomeFeatures(model)}
      </div>
    `;
  }

  private renderHomeWhatsNewPreview(news: HomeModel["news"]) {
    const unread = this.newsSignalArmed && this.announcementLoaded;
    if (news.empty || !unread) {
      return nothing;
    }

    return html`
      <section
        class="inspector-whats-new-preview"
        data-inspector-home-band="news"
        data-unread="true"
        role="note"
        aria-label="New CopilotKit update"
      >
        <button
          type="button"
          class="inspector-whats-new-preview-body"
          data-inspector-whats-new-preview
          aria-label="Open What's New"
          style=${INTERACTIVE_FOCUS_BASE_STYLE}
          @click=${() => this.handleMenuSelect(WHATS_NEW_MENU_KEY)}
        >
          <span class="inspector-whats-new-preview-copy">
            <span class="inspector-whats-new-preview-title">
              <span class="inspector-home-story-unread">New</span>
              <strong>${news.title}</strong>
            </span>
            <span>${news.previewText}</span>
          </span>
          <span class="inspector-whats-new-preview-action">
            View update ${this.renderIcon("ArrowRight")}
          </span>
        </button>
      </section>
    `;
  }

  private renderWhatsNewView() {
    const state = this.getWhatsNewState();
    const news = this.getHomeModel().news;
    const updatedAt = this.announcementTimestamp
      ? new Date(this.announcementTimestamp)
      : null;
    const updatedLabel =
      updatedAt && !Number.isNaN(updatedAt.getTime())
        ? new Intl.DateTimeFormat(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          }).format(updatedAt)
        : null;
    return html`
      <div
        class="inspector-home inspector-whats-new"
        data-inspector-whats-new
        data-cpk-whats-new
        data-cpk-whats-new-state=${state}
      >
        <header class="inspector-whats-new-header">
          <h1 class="inspector-home-title">What's New</h1>
          ${
            updatedLabel
              ? html`
                <p class="inspector-whats-new-updated">
                  Updated
                  <time datetime=${updatedAt?.toISOString()}
                    >${updatedLabel}</time
                  >
                </p>
              `
              : nothing
          }
        </header>
        <section class="inspector-home-news" aria-label="CopilotKit updates">
          ${
            news.empty || !news.documentHtml
              ? html`
                <article class="inspector-whats-new-empty">
                  <h2 class="inspector-home-card-title">${news.title}</h2>
                  <p class="inspector-home-card-copy">${news.previewText}</p>
                </article>
              `
              : html`
                <article class="inspector-whats-new-document">
                  <div
                    class="announcement-content"
                    @click=${this.handleAnnouncementContentClick}
                  >
                    ${unsafeHTML(news.documentHtml)}
                  </div>
                </article>
              `
          }
        </section>
      </div>
    `;
  }

  private renderHomeIntelligenceHud(model: HomeModel) {
    const project = model.project;
    const connected = model.hero.connection === "connected";
    const action = model.hero.action;
    const renewing = action?.kind === "renew";
    return html`
      <section
        class="inspector-home-section inspector-intelligence-hud"
        data-inspector-home-card="intelligence"
        data-state=${connected ? "connected" : "disconnected"}
        aria-label="Intelligence ${
          connected ? "connected" : renewing ? "plan expired" : "not enabled"
        }"
      >
        <header class="inspector-intelligence-hud-header">
          <div class="inspector-intelligence-hud-heading">
            <h2 class="inspector-home-section-title">
              ${connected ? "Intelligence" : model.hero.title}
            </h2>
            ${
              connected
                ? nothing
                : html`
                  <p class="inspector-intelligence-hud-description">
                    ${model.hero.body}
                  </p>
                `
            }
          </div>
          <div class="inspector-intelligence-hud-header-actions">
            ${
              connected || renewing
                ? html`
                  <span
                    class="inspector-intelligence-hud-state"
                    data-tone=${connected ? "success" : "checking"}
                  >
                    <span aria-hidden="true"></span>
                    ${connected ? "Connected" : "Plan expired"}
                  </span>
                `
                : nothing
            }
            ${
              !connected && action
                ? html`
                  <a
                    class="inspector-intelligence-hud-action inspector-intelligence-hud-connect-action"
                    data-inspector-home-intelligence-action=${action.kind}
                    href=${action.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="${action.label} (opens in a new tab)"
                    style=${INTERACTIVE_FOCUS_BASE_STYLE}
                    @click=${() => this.handleHomeHeroCta(action)}
                  >
                    ${action.label} ${this.renderIcon("ArrowUpRight")}
                  </a>
                `
                : nothing
            }
          </div>
        </header>

        ${
          connected
            ? html`
              <div
                class="inspector-intelligence-hud-details"
                role="group"
                aria-label="Intelligence account details"
              >
                <section
                  class="inspector-intelligence-hud-project"
                  data-inspector-metadata=${
                    model.projectLinked && project ? "identity" : nothing
                  }
                  aria-label=${
                    model.projectLinked && project
                      ? "Inspector account details"
                      : nothing
                  }
                >
                  <span class="inspector-intelligence-hud-detail-label">
                    Project
                  </span>
                  <strong class="inspector-intelligence-hud-detail-value">
                    ${
                      model.projectLinked && project
                        ? html`<span>${project.projectName}</span>`
                        : "Not linked"
                    }
                  </strong>
                  ${
                    model.projectLinked && project
                      ? html`
                        <span
                          class="inspector-intelligence-hud-detail-subvalue"
                        >
                          ${project.organizationName}
                        </span>
                      `
                      : nothing
                  }
                </section>
                <section class="inspector-intelligence-hud-plan">
                  <div class="inspector-intelligence-hud-plan-summary">
                    <span class="inspector-intelligence-hud-detail-label">
                      Plan
                    </span>
                    <strong class="inspector-intelligence-hud-detail-value">
                      ${
                        project?.planLabel
                          ? html`
                            <span data-inspector-metadata="plan">
                              ${project.planLabel}
                            </span>
                          `
                          : "No plan"
                      }
                    </strong>
                    ${
                      project
                        ? html`
                          <span
                            class="inspector-intelligence-hud-detail-subvalue"
                          >
                            License ${project.license}
                          </span>
                        `
                        : nothing
                    }
                    ${
                      action
                        ? html`
                          <a
                            class="inspector-intelligence-hud-action inspector-intelligence-hud-plan-action"
                            data-inspector-home-intelligence-action=${action.kind}
                            href=${action.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="${action.label} (opens in a new tab)"
                            style=${INTERACTIVE_FOCUS_BASE_STYLE}
                            @click=${() => this.handleHomeHeroCta(action)}
                          >
                            ${action.label} ${this.renderIcon("ArrowUpRight")}
                          </a>
                        `
                        : nothing
                    }
                  </div>
                  <div
                    class="inspector-intelligence-hud-usage"
                    role="group"
                    aria-label="Threads usage"
                  >
                    <span class="inspector-intelligence-hud-detail-label">
                      Threads usage
                    </span>
                    <strong class="inspector-intelligence-hud-detail-value">
                      ${project?.usage?.limitLabel ?? "Unavailable"}
                    </strong>
                    ${
                      project?.usage?.ratio !== undefined
                        ? html`<span
                          class="inspector-home-usage-bar"
                          aria-hidden="true"
                          ><span
                            style="width:${Math.min(
                              100,
                              Math.round(project.usage.ratio * 100),
                            )}%"
                          ></span
                        ></span>`
                        : nothing
                    }
                  </div>
                </section>
              </div>
            `
            : nothing
        }
      </section>
    `;
  }

  private renderHomeSystemHealth(model: HomeModel) {
    const runtime = model.runtime;
    const health = runtime.health;
    const runtimeDetail = runtime.url ?? "Runtime URL not configured";
    const connectionDetail =
      health.liveUpdates.tone === "success"
        ? "New events will appear here."
        : health.lastEvent.timestamp !== undefined
          ? `Last activity at ${formatTimestamp(health.lastEvent.timestamp)}`
          : "Waiting for a connection";
    const signals: Array<{
      id: "runtime" | "connection" | "last-event";
      label: string;
      value: string;
      detail: string;
      tone: HomeRuntimeHealthTone;
      eventId?: string;
      agentId?: string;
    }> = [
      {
        id: "runtime",
        label: "Runtime",
        value: health.runtime.label,
        detail: runtimeDetail,
        tone: health.runtime.tone,
      },
      {
        id: "connection",
        label: "Live updates",
        value: health.liveUpdates.label,
        detail: connectionDetail,
        tone: health.liveUpdates.tone,
      },
      {
        id: "last-event",
        label: "Recent activity",
        value: health.lastEvent.type ?? health.lastEvent.label,
        detail:
          health.lastEvent.timestamp !== undefined
            ? formatRelativeTimestamp(health.lastEvent.timestamp)
            : "Waiting for an agent to run.",
        tone: health.lastEvent.tone,
        eventId: health.lastEvent.id,
        agentId: health.lastEvent.agentId,
      },
    ];
    return html`
      <section
        class="inspector-home-section inspector-system-health-section"
        data-inspector-home-band="health"
      >
        <header
          class="inspector-home-section-header inspector-system-health-header"
        >
          <div class="inspector-system-health-heading">
            <h1 class="inspector-home-section-title">System Health</h1>
          </div>
          <span
            class="inspector-system-health-state"
            data-tone=${health.state === "healthy" ? "success" : health.state}
          >
            <span aria-hidden="true"></span>
            ${health.label}
          </span>
        </header>
        <dl
          class="inspector-system-health"
          aria-label="System Health"
          data-inspector-home-card="runtime"
          data-health-state=${health.state}
        >
          ${signals.map(
            (signal) => html`
              <div
                class="inspector-system-health-signal"
                data-runtime-health-signal=${signal.id}
                data-tone=${signal.tone}
              >
                <span class="inspector-system-health-copy">
                  <dt>${signal.label}</dt>
                  <dd title=${signal.value}>
                    ${
                      signal.eventId
                        ? html`
                          <button
                            type="button"
                            class="inspector-system-health-event-link"
                            aria-label="View ${signal.value.toLowerCase()} in AG-UI Events"
                            @click=${() => {
                              if (signal.eventId) {
                                this.handleHomeLastEventSelect(
                                  signal.eventId,
                                  signal.agentId,
                                );
                              }
                            }}
                          >
                            <span class="inspector-system-health-event-type"
                              >${signal.value}</span
                            >
                            <small class="inspector-system-health-event-meta">
                              <span>${signal.detail}</span>
                              <strong>View event</strong>
                            </small>
                          </button>
                        `
                        : signal.value
                    }
                  </dd>
                  ${
                    signal.eventId
                      ? null
                      : signal.id === "runtime"
                        ? html`
                          <small
                            class="inspector-system-health-url"
                            data-full-value=${runtime.url ?? signal.detail}
                            aria-label=${signal.detail}
                            title=${signal.detail}
                            tabindex="0"
                          >
                            <span>${signal.detail}</span>
                          </small>
                        `
                        : html`<small
                          class="inspector-system-health-detail"
                          title=${signal.detail}
                          >${signal.detail}</small
                        >`
                  }
                </span>
              </div>
            `,
          )}
        </dl>
      </section>
    `;
  }

  private renderEventErrorBanner(key: InspectorEventErrorSource) {
    const error = this.eventErrorDetails[key];
    if (!error) return nothing;
    const guide = EVENT_ERROR_GUIDANCE[key];
    return html`
      <div
        class="mx-3 mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left text-[11px] text-rose-950"
        role="alert"
        tabindex="0"
        data-cpk-event-error=${key}
        @click=${this.refocusEventErrorLanding}
        @keydown=${this.handleEventErrorBannerKeydown}
      >
        <span class="mt-0.5 shrink-0">${this.renderIcon("TriangleAlert")}</span>
        <div class="min-w-0 flex-1 space-y-1">
          <p class="font-semibold">${guide.title}</p>
          ${error.agentId ? html`<p>Agent: ${error.agentId}</p>` : nothing}
          ${error.toolName ? html`<p>Tool: ${error.toolName}</p>` : nothing}
          <p class="break-words leading-relaxed">${error.message}</p>
          ${
            guide.advice
              ? html`<p class="leading-relaxed">${guide.advice}</p>`
              : nothing
          }
          ${
            guide.highlight && this.hasEventErrorHighlight(key)
              ? html`<p class="leading-relaxed">${guide.highlight}</p>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private handleEventErrorBannerKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.refocusEventErrorLanding(event);
  };

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

  private renderHomeFeatures(model: HomeModel) {
    const enabledServices = model.services.filter((service) => service.enabled);
    const disabledServices = model.services.filter(
      (service) => !service.enabled,
    );
    const renderService = (service: HomeModel["services"][number]) => html`
      <a
        class="inspector-home-feature"
        data-inspector-service=${service.id}
        data-state=${service.enabled ? "on" : "off"}
        href=${this.appendRefParam(service.docsUrl, "cpk-inspector-home")}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Learn more about ${service.label}, currently ${
          service.enabled ? "on" : "off"
        }"
      >
        <span>${service.label}</span>
        <small>${service.enabled ? "On" : "Off"}</small>
        <span class="inspector-home-feature-arrow" aria-hidden="true">
          ${this.renderIcon("ArrowUpRight")}
        </span>
      </a>
    `;
    return html`
      <section
        class="inspector-home-section inspector-home-features"
        data-inspector-home-card="services"
      >
        <header class="inspector-home-section-header">
          <h2 class="inspector-home-section-title">Features</h2>
          <span>
            ${enabledServices.length} active, ${disabledServices.length} off
          </span>
        </header>
        ${
          model.services.length === 0
            ? html`
                <p class="inspector-home-features-empty">
                  Feature availability is unavailable for this runtime.
                </p>
              `
            : html`
              <div class="inspector-home-feature-groups">
                <section
                  class="inspector-home-feature-group"
                  data-feature-state-group="active"
                  aria-label="Active features"
                >
                  <header class="inspector-home-feature-group-header">
                    <strong>Active</strong>
                    <span>${enabledServices.length}</span>
                  </header>
                  <div class="inspector-home-feature-list">
                    ${
                      enabledServices.length > 0
                        ? enabledServices.map(renderService)
                        : html`
                            <p class="inspector-home-feature-group-empty">None enabled</p>
                          `
                    }
                  </div>
                </section>
                <section
                  class="inspector-home-feature-group"
                  data-feature-state-group="available"
                  aria-label="Available features"
                >
                  <header class="inspector-home-feature-group-header">
                    <strong>Available</strong>
                    <span>${disabledServices.length}</span>
                  </header>
                  <div class="inspector-home-feature-list">
                    ${
                      disabledServices.length > 0
                        ? disabledServices.map(renderService)
                        : html`
                            <p class="inspector-home-feature-group-empty">Everything is active</p>
                          `
                    }
                  </div>
                </section>
              </div>
            `
        }
      </section>
    `;
  }

  private handleHomeHeroCta(action: HomeHeroAction): void {
    if (this.core?.telemetryDisabled) return;
    trackHomeCtaClicked({ action_kind: action.kind });
  }

  private maybeTrackHomeViewed(): void {
    if (this.selectedMenu !== "home" || this.settingsOpen || !this.isOpen) {
      return;
    }
    if (!this.homeViewedThisOpen && !this.core?.telemetryDisabled) {
      this.homeViewedThisOpen = true;
      trackHomeViewed();
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
      ? this.renderContextDropdown(iconRail)
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
                    <div
                      class="resize-handle pointer-events-auto absolute bottom-0 left-0 flex h-7 w-7 cursor-nesw-resize items-center justify-center text-gray-600 transition hover:text-gray-900"
                      data-resize-edge="sw"
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
      this.selectedMenu = hudMenu;
      this.lastSelectedMenuByGroup[getGroupForMenu(hudMenu)] = hudMenu;
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

  private sanitizeForLogging(
    value: unknown,
    depth = 0,
    seen = new WeakSet<object>(),
  ): SanitizedValue {
    if (value === undefined) {
      return "[undefined]";
    }

    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof value === "string") {
      return value;
    }

    if (
      typeof value === "bigint" ||
      typeof value === "symbol" ||
      typeof value === "function"
    ) {
      return String(value);
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      if (depth >= 4) {
        return "[Truncated depth]" as SanitizedValue;
      }
      return value.map((item) =>
        this.sanitizeForLogging(item, depth + 1, seen),
      );
    }

    if (typeof value === "object") {
      if (seen.has(value as object)) {
        return "[Circular]" as SanitizedValue;
      }
      seen.add(value as object);

      if (depth >= 4) {
        return "[Truncated depth]" as SanitizedValue;
      }

      const result: Record<string, SanitizedValue> = {};
      for (const [key, entry] of Object.entries(
        value as Record<string, unknown>,
      )) {
        result[key] = this.sanitizeForLogging(entry, depth + 1, seen);
      }
      return result;
    }

    return String(value);
  }

  private normalizeEventPayload(
    _type: InspectorAgentEventType,
    payload: unknown,
  ): SanitizedValue {
    if (payload && typeof payload === "object" && "event" in payload) {
      const { event, ...rest } = payload as Record<string, unknown>;
      const cleaned =
        Object.keys(rest).length === 0 ? event : { event, ...rest };
      return this.sanitizeForLogging(cleaned);
    }

    return this.sanitizeForLogging(payload);
  }

  private normalizeMessageContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (
      content &&
      typeof content === "object" &&
      "text" in (content as Record<string, unknown>)
    ) {
      const maybeText = (content as Record<string, unknown>).text;
      if (typeof maybeText === "string") {
        return maybeText;
      }
    }

    if (content === null || content === undefined) {
      return "";
    }

    if (typeof content === "object") {
      try {
        return JSON.stringify(this.sanitizeForLogging(content));
      } catch {
        return "";
      }
    }

    return String(content);
  }

  private normalizeToolCalls(raw: unknown): InspectorToolCall[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const call = entry as Record<string, unknown>;
        const fn = call.function as Record<string, unknown> | undefined;
        const functionName =
          typeof fn?.name === "string"
            ? fn.name
            : typeof call.toolName === "string"
              ? call.toolName
              : undefined;
        const args =
          fn && "arguments" in fn
            ? (fn as Record<string, unknown>).arguments
            : call.arguments;

        const normalized: InspectorToolCall = {
          id: typeof call.id === "string" ? call.id : undefined,
          toolName:
            typeof call.toolName === "string" ? call.toolName : functionName,
          status: typeof call.status === "string" ? call.status : undefined,
        };

        if (functionName) {
          normalized.function = {
            name: functionName,
            arguments: this.sanitizeForLogging(args),
          };
        }

        return normalized;
      })
      .filter((call): call is InspectorToolCall => Boolean(call));
  }

  private normalizeAgentMessage(message: unknown): InspectorMessage | null {
    if (!message || typeof message !== "object") {
      return null;
    }

    const raw = message as Record<string, unknown>;
    const role = typeof raw.role === "string" ? raw.role : "unknown";
    const contentText = this.normalizeMessageContent(raw.content);
    const toolCalls = this.normalizeToolCalls(raw.toolCalls);

    return {
      id: typeof raw.id === "string" ? raw.id : undefined,
      role,
      contentText,
      contentRaw:
        raw.content !== undefined
          ? this.sanitizeForLogging(raw.content)
          : undefined,
      toolCalls,
      toolCallId:
        typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
      activityType:
        typeof raw.activityType === "string" ? raw.activityType : undefined,
    };
  }

  private normalizeAgentMessages(messages: unknown): InspectorMessage[] | null {
    if (!Array.isArray(messages)) {
      return null;
    }

    const normalized = messages
      .map((message) => this.normalizeAgentMessage(message))
      .filter((msg): msg is InspectorMessage => msg !== null);

    return normalized;
  }

  private normalizeContextStore(
    context: Readonly<Record<string, unknown>> | null | undefined,
  ): Record<string, { description?: string; value: unknown }> {
    if (!context || typeof context !== "object") {
      return {};
    }

    const normalized: Record<string, { description?: string; value: unknown }> =
      {};
    for (const [key, entry] of Object.entries(context)) {
      if (
        entry &&
        typeof entry === "object" &&
        "value" in (entry as Record<string, unknown>)
      ) {
        const candidate = entry as Record<string, unknown>;
        const description =
          typeof candidate.description === "string" &&
          candidate.description.trim().length > 0
            ? candidate.description
            : undefined;
        normalized[key] = { description, value: candidate.value };
      } else {
        normalized[key] = { value: entry };
      }
    }

    return normalized;
  }

  private contextOptions: Array<{ key: string; label: string }> = [
    { key: "all-agents", label: "All Agents" },
  ];

  private selectedContext = "all-agents";
  private expandedRows: Set<string> = new Set();
  private copiedEvents: Set<string> = new Set();
  private expandedTools: Set<string> = new Set();
  private expandedContextItems: Set<string> = new Set();
  private copiedContextItems: Set<string> = new Set();

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
    const agents = this._core?.agents ?? {};
    if (
      preferredAgentId &&
      preferredAgentId !== "all-agents" &&
      agents[preferredAgentId]
    ) {
      return preferredAgentId;
    }
    return Object.keys(agents)[0] ?? null;
  }

  private teardownPlaygroundAgent(): void {
    this.playgroundAgentUnsubscribe?.();
    this.playgroundAgentUnsubscribe = null;
    if (this.playgroundAgent && this.playgroundIsRunning) {
      this.playgroundAgent.abortRun();
      void this.playgroundAgent.detachActiveRun().catch(() => {});
    }
    this.playgroundAgent = null;
    this.playgroundAgentId = null;
    this.playgroundMessages = [];
    this.playgroundIsRunning = false;
    this.playgroundRunStartedAt = null;
    this.playgroundReasoningDurations.clear();
  }

  private syncPlaygroundMessages(): void {
    this.playgroundMessages =
      this.normalizeAgentMessages(this.playgroundAgent?.messages) ?? [];
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
    const agentId = this.resolvePlaygroundAgentId(
      preferredAgentId ?? this.selectedContext,
    );
    const sourceAgent = agentId
      ? typeof this._core?.getAgent === "function"
        ? this._core.getAgent(agentId)
        : this._core?.agents[agentId]
      : undefined;

    this.teardownPlaygroundAgent();
    this.playgroundError = null;
    this.playgroundSourceThreadId = null;
    this.playgroundShowEphemeralNotice =
      showEphemeralNotice && this._core?.runtimeMode !== "intelligence";

    if (!agentId || !sourceAgent) {
      this.requestUpdate();
      return;
    }

    if (this.selectedContext !== agentId) {
      this.selectedContext = agentId;
    }

    const playgroundAgent = sourceAgent.clone();
    playgroundAgent.threadId = createPlaygroundThreadId();
    playgroundAgent.setMessages(seedMessages);
    playgroundAgent.setState(seedState);
    const subscriber: AgentSubscriber = {
      onMessagesChanged: () => this.syncPlaygroundMessages(),
      onActivitySnapshotEvent: () => this.syncPlaygroundMessages(),
      onActivityDeltaEvent: () => this.syncPlaygroundMessages(),
      onRunErrorEvent: ({ event }) => {
        this.playgroundError =
          "message" in event && typeof event.message === "string"
            ? event.message
            : "The agent run failed.";
        this.requestUpdate();
      },
      onRunFailed: ({ error }) => {
        this.playgroundError = error.message;
        this.requestUpdate();
      },
    };
    const { unsubscribe } = playgroundAgent.subscribe(subscriber);

    this.playgroundAgent = playgroundAgent;
    this.playgroundAgentId = agentId;
    this.playgroundAgentUnsubscribe = unsubscribe;
    this.syncPlaygroundMessages();
  }

  private mapThreadMessagesToPlayground(
    messages: ThreadDebuggerMessage[],
  ): Message[] {
    const mapped: Message[] = [];
    for (const message of messages) {
      if (message.role === "user") {
        mapped.push({
          id: message.id,
          role: "user",
          content: message.content ?? "",
        });
      } else if (message.role === "assistant") {
        mapped.push({
          id: message.id,
          role: "assistant",
          content: message.content ?? "",
          ...(message.toolCalls?.length
            ? {
                toolCalls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function" as const,
                  function: {
                    name: toolCall.name,
                    arguments:
                      typeof toolCall.args === "string"
                        ? toolCall.args
                        : JSON.stringify(toolCall.args),
                  },
                })),
              }
            : {}),
        });
      } else if (message.role === "tool" && message.toolCallId) {
        mapped.push({
          id: message.id,
          role: "tool",
          content: message.content ?? "",
          toolCallId: message.toolCallId,
        });
      }
    }
    return mapped;
  }

  private handlePlaygroundThreadSourceChange = async (
    event: Event,
  ): Promise<void> => {
    const threadId = (event.currentTarget as HTMLSelectElement).value;
    if (!threadId) {
      this.startPlaygroundSession(false);
      return;
    }

    const core = this._core;
    const thread = this._threads.find((candidate) => candidate.id === threadId);
    if (!core?.runtimeUrl || !thread) return;

    this.playgroundIsLoadingThread = true;
    this.playgroundError = null;
    this.requestUpdate();

    try {
      const baseUrl = core.runtimeUrl.replace(/\/+$/, "");
      const encodedThreadId = encodeURIComponent(threadId);
      const [messagesResponse, stateResponse] = await Promise.all([
        fetch(`${baseUrl}/threads/${encodedThreadId}/messages`, {
          headers: { ...core.headers },
        }),
        fetch(`${baseUrl}/threads/${encodedThreadId}/state`, {
          headers: { ...core.headers },
        }),
      ]);
      if (!messagesResponse.ok) {
        throw new Error(
          `Failed to load thread (HTTP ${messagesResponse.status}).`,
        );
      }
      const messagesBody = (await messagesResponse.json()) as {
        messages?: ThreadDebuggerMessage[];
      };
      const stateBody = stateResponse.ok
        ? ((await stateResponse.json()) as { state?: unknown })
        : { state: {} };
      this.startPlaygroundSession(
        false,
        this.mapThreadMessagesToPlayground(messagesBody.messages ?? []),
        stateBody.state ?? {},
        thread.agentId,
      );
      this.playgroundSourceThreadId = threadId;
    } catch (error) {
      this.playgroundError =
        error instanceof Error ? error.message : "Failed to load thread.";
    } finally {
      this.playgroundIsLoadingThread = false;
      this.requestUpdate();
    }
  };

  private runPlaygroundAgent = async (): Promise<void> => {
    const core = this._core;
    const agent = this.playgroundAgent;
    if (!core || !agent || this.playgroundIsRunning) return;

    this.playgroundIsRunning = true;
    this.playgroundRunStartedAt = Date.now();
    this.playgroundError = null;
    this.requestUpdate();
    try {
      await core.runAgent({ agent });
    } catch (error) {
      this.playgroundError =
        error instanceof Error ? error.message : "The agent run failed.";
    } finally {
      this.playgroundIsRunning = false;
      this.syncPlaygroundMessages();
      let reasoningMessage: InspectorMessage | undefined;
      for (
        let index = this.playgroundMessages.length - 1;
        index >= 0;
        index -= 1
      ) {
        const message = this.playgroundMessages[index];
        if (message?.role === "reasoning") {
          reasoningMessage = message;
          break;
        }
      }
      if (reasoningMessage?.id && this.playgroundRunStartedAt !== null) {
        this.playgroundReasoningDurations.set(
          reasoningMessage.id,
          Date.now() - this.playgroundRunStartedAt,
        );
      }
      this.playgroundRunStartedAt = null;
      this.requestUpdate();
    }
  };

  private sendPlaygroundMessage(content: string): void {
    if (
      !content ||
      this.playgroundIsRunning ||
      this.playgroundIsLoadingThread
    ) {
      return;
    }

    const selectedAgentId = this.resolvePlaygroundAgentId(this.selectedContext);
    if (!this.playgroundAgent || this.playgroundAgentId !== selectedAgentId) {
      this.startPlaygroundSession(false, [], {}, selectedAgentId ?? undefined);
    }
    if (!this.playgroundAgent) return;

    this.playgroundAgent.addMessage({
      id: createPlaygroundThreadId(),
      role: "user",
      content,
    });
    this.playgroundInput = "";
    this.syncPlaygroundMessages();
    void this.runPlaygroundAgent();
  }

  private handlePlaygroundSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.sendPlaygroundMessage(this.playgroundInput.trim());
  };

  private handlePlaygroundSuggestion = (message: string): void => {
    this.sendPlaygroundMessage(message.trim());
  };

  private handlePlaygroundInput = (event: Event): void => {
    const input = event.currentTarget as HTMLTextAreaElement;
    this.playgroundInput = input.value;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
    this.requestUpdate();
  };

  private handlePlaygroundKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  };

  private handlePlaygroundRetry = (): void => {
    const agent = this.playgroundAgent;
    if (!agent || this.playgroundIsRunning) return;
    let lastUserIndex = -1;
    for (let index = agent.messages.length - 1; index >= 0; index -= 1) {
      if (agent.messages[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) return;
    agent.setMessages(agent.messages.slice(0, lastUserIndex + 1));
    this.syncPlaygroundMessages();
    void this.runPlaygroundAgent();
  };

  private handlePlaygroundStop = (): void => {
    this.playgroundAgent?.abortRun();
  };

  private renderPlaygroundComposer(
    agentId: string | null,
    busy: boolean,
    hasRetry: boolean,
    centered = false,
  ) {
    const placeholder = !agentId
      ? "Waiting for an agent..."
      : this.playgroundIsLoadingThread
        ? "Loading thread..."
        : "Type a message...";
    const sendDisabled =
      !agentId ||
      this.playgroundIsLoadingThread ||
      (!this.playgroundIsRunning && !this.playgroundInput.trim());

    return html`
      <form
        class=${centered ? "mt-5 w-full" : "bg-white px-3 pb-3 pt-1.5"}
        @submit=${this.handlePlaygroundSubmit}
      >
        ${
          this.playgroundError
            ? html`<div
                class="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] text-rose-950"
                role="alert"
                data-playground-error
              >
                <span class="mt-0.5 shrink-0"
                  >${this.renderIcon("TriangleAlert")}</span
                >
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">Agent run failed</p>
                  <p class="mt-0.5 break-words leading-relaxed">
                    ${this.playgroundError}
                  </p>
                </div>
                ${
                  hasRetry
                    ? html`
                        <button
                          type="button"
                          class="shrink-0 rounded-md border border-rose-200 bg-white px-2 py-1 font-medium text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-1 disabled:opacity-50"
                          ?disabled=${busy}
                          @click=${this.handlePlaygroundRetry}
                        >
                          Retry
                        </button>
                      `
                    : nothing
                }
              </div>`
            : nothing
        }
        <div
          class="mx-auto flex max-w-3xl items-end gap-1.5 rounded-[28px] bg-white px-2.5 py-1.5 shadow-[0_4px_4px_0_#0000000a,0_0_1px_0_#0000009e] transition-shadow duration-200 focus-within:shadow-[0_6px_18px_0_#00000014,0_0_1px_0_#0000009e]"
        >
          <textarea
            class="min-h-[40px] max-h-32 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[13px] leading-5 text-gray-900 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
            rows="1"
            placeholder=${placeholder}
            aria-label="Playground message"
            .value=${this.playgroundInput}
            ?disabled=${!agentId || busy}
            @input=${this.handlePlaygroundInput}
            @keydown=${this.handlePlaygroundKeyDown}
          ></textarea>
          <button
            type=${this.playgroundIsRunning ? "button" : "submit"}
            class=${`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 [&>svg]:h-[18px] [&>svg]:w-[18px] ${
              sendDisabled
                ? "cursor-not-allowed bg-[#00000014] text-[rgb(13,13,13)] opacity-50"
                : "cursor-pointer bg-black text-white hover:opacity-70 active:opacity-60"
            }`}
            aria-label=${
              this.playgroundIsRunning
                ? "Stop agent"
                : "Send playground message"
            }
            ?disabled=${sendDisabled}
            @click=${
              this.playgroundIsRunning ? this.handlePlaygroundStop : nothing
            }
          >
            ${this.renderIcon(this.playgroundIsRunning ? "Square" : "ArrowUp")}
          </button>
        </div>
        <p
          class="mx-auto max-w-3xl px-3 py-2 text-center text-[10px] leading-4 text-gray-500"
        >
          AI can make mistakes. Please verify important information.
        </p>
      </form>
    `;
  }

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
            ${this.renderEventsTable()}
          </div>
        </div>
      `;
    }

    if (this.selectedMenu === "playground") {
      return this.renderPlaygroundView();
    }

    if (this.selectedMenu === "agents") {
      return this.renderAgentsView();
    }

    if (this.selectedMenu === "frontend-tools") {
      return this.renderToolsView();
    }

    if (this.selectedMenu === "capabilities") {
      return this.renderCapabilitiesView();
    }

    if (this.selectedMenu === "agent-context") {
      return this.renderContextView();
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
    const sourceThreads = this._threads.filter(
      (thread) => !agentId || thread.agentId === agentId,
    );
    const visibleMessages = this.playgroundMessages.filter(
      (message) =>
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "reasoning" ||
        message.role === "activity",
    );
    const hasRetry =
      this.playgroundAgent?.messages.some(
        (message) => message.role === "user",
      ) ?? false;
    const runtimeMode = this._core?.runtimeMode ?? "sse";
    const runtimeLabel = this._core?.runtimeUrl ?? "Self-managed agent";
    const busy = this.playgroundIsRunning || this.playgroundIsLoadingThread;
    const suggestions =
      agentId && this._core
        ? this._core.getSuggestions(agentId).suggestions
        : [];
    const lastAssistantIndex = visibleMessages.reduce(
      (last, message, index) => (message.role === "assistant" ? index : last),
      -1,
    );
    const lastReasoningIndex = visibleMessages.reduce(
      (last, message, index) => (message.role === "reasoning" ? index : last),
      -1,
    );
    const showWelcome =
      !this.playgroundIsLoadingThread && visibleMessages.length === 0;

    return html`
      <div
        class="cpk-playground-root flex h-full min-h-[420px] flex-col bg-white"
      >
        <header
          class="cpk-playground-header flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <h2 class="text-xs font-semibold text-gray-900">Playground</h2>
              <span
                class="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-600"
                >${runtimeMode.toUpperCase()}</span
              >
            </div>
            <div
              class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px] text-gray-600"
            >
              <span class="truncate">Agent: ${agentId ?? "waiting..."}</span>
              <span
                class="h-3 w-px shrink-0 bg-gray-200"
                aria-hidden="true"
              ></span>
              <span class="truncate" title=${runtimeLabel}>${runtimeLabel}</span>
            </div>
          </div>
          <div
            class="cpk-playground-actions ml-auto flex min-w-0 items-center gap-2"
          >
            ${
              sourceThreads.length > 0
                ? html`
                    <label class="sr-only" for="cpk-playground-thread-source"
                      >Start from a thread</label
                    >
                    <select
                      id="cpk-playground-thread-source"
                      class="cpk-playground-thread-select max-w-[200px] rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] text-gray-700 outline-none transition hover:border-gray-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                      .value=${this.playgroundSourceThreadId ?? ""}
                      ?disabled=${busy}
                      @change=${this.handlePlaygroundThreadSourceChange}
                    >
                      <option value="">Load a thread...</option>
                      ${sourceThreads.map(
                        (thread) => html`
                          <option value=${thread.id}>
                            ${
                              thread.name?.trim() ||
                              `Thread ${thread.id.slice(0, 8)}`
                            }
                          </option>
                        `,
                      )}
                    </select>
                  `
                : nothing
            }
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-3.5 [&>svg]:w-3.5"
              ?disabled=${busy || !agentId}
              @click=${() => this.startPlaygroundSession(true)}
            >
              ${this.renderIcon("Plus")} <span>New thread</span>
            </button>
          </div>
        </header>

        ${
          this.playgroundShowEphemeralNotice && runtimeMode !== "intelligence"
            ? html`
                <div
                  role="alert"
                  class="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-[10px] text-violet-950"
                  data-playground-ephemeral-notice
                >
                  <span
                    class="mt-0.5 text-violet-600 [&>svg]:h-3.5 [&>svg]:w-3.5"
                    >${this.renderIcon("Clock3")}</span
                  >
                  <p class="min-w-0 flex-1 leading-relaxed">
                    Scratch threads are ephemeral and will be deleted when your
                    local session ends. Need durable history?
                    <a
                      class="font-semibold underline decoration-violet-300 underline-offset-2 hover:decoration-violet-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1"
                      href=${this.getThreadsIntelligenceSignupUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      >Set up Intelligence</a
                    >.
                  </p>
                  <button
                    type="button"
                    class="rounded p-0.5 text-violet-500 transition hover:bg-violet-100 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1"
                    aria-label="Dismiss ephemeral thread notice"
                    @click=${() => {
                      this.playgroundShowEphemeralNotice = false;
                      this.requestUpdate();
                    }}
                  >
                    ${this.renderIcon("X")}
                  </button>
                </div>
              `
            : nothing
        }

        <div
          class="min-h-0 flex-1 overflow-y-auto px-3 py-3"
          data-playground-messages
        >
          ${
            this.playgroundIsLoadingThread
              ? html`
                  <div
                    class="flex h-full items-center justify-center gap-1.5 text-[10px] text-gray-600"
                  >
                    <span
                      class="text-gray-500 [&>svg]:animate-spin"
                      aria-hidden="true"
                      >${this.renderIcon("LoaderCircle")}</span
                    >
                    Loading thread into a scratch session...
                  </div>
                `
              : visibleMessages.length === 0
                ? html`
                    <div
                      class="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center text-center"
                    >
                      <p class="text-base font-medium tracking-tight text-gray-900">
                        How can I help you today?
                      </p>
                      ${this.renderPlaygroundComposer(
                        agentId,
                        busy,
                        hasRetry,
                        true,
                      )}
                    </div>
                  `
                : html`
                    <div class="mx-auto flex max-w-3xl flex-col pb-5">
                      ${visibleMessages.map((message, index) => {
                        const isUser = message.role === "user";
                        const isReasoning = message.role === "reasoning";
                        const isActivity = message.role === "activity";
                        const content = isActivity
                          ? (message.activityType ?? "Agent activity")
                          : message.contentText;
                        if (
                          !isReasoning &&
                          !content &&
                          message.toolCalls.length === 0
                        ) {
                          return nothing;
                        }
                        if (isReasoning) {
                          const isStreaming =
                            this.playgroundIsRunning &&
                            index === lastReasoningIndex;
                          const duration = message.id
                            ? this.playgroundReasoningDurations.get(message.id)
                            : undefined;
                          const durationLabel =
                            duration === undefined || duration < 1000
                              ? "a few seconds"
                              : `${Math.round(duration / 1000)} seconds`;
                          const label = isStreaming
                            ? "Thinking…"
                            : `Thought for ${durationLabel}`;

                          if (isStreaming) {
                            return html`
                              <section
                                class="cpk-playground-message-enter my-1 text-[11px] text-gray-500"
                                data-playground-message-role="reasoning"
                              >
                                <div
                                  class="inline-flex items-center gap-1 py-1 font-medium"
                                >
                                  <span>${label}</span>
                                  ${
                                    content
                                      ? nothing
                                      : html`
                                          <span
                                            class="cpk-playground-thinking-dot ml-1 h-1.5 w-1.5 rounded-full bg-gray-500"
                                            aria-hidden="true"
                                          ></span>
                                        `
                                  }
                                </div>
                                ${
                                  content
                                    ? html`<div
                                        class="pb-2 pt-1 leading-5 text-gray-500"
                                      >
                                        ${content}
                                      </div>`
                                    : nothing
                                }
                              </section>
                            `;
                          }

                          return content
                            ? html`
                                <details
                                  class="cpk-playground-message-enter cpk-playground-reasoning my-1 text-[11px] text-gray-500"
                                  data-playground-message-role="reasoning"
                                >
                                  <summary
                                    class="inline-flex cursor-pointer list-none items-center gap-1 py-1 font-medium transition-colors hover:text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1"
                                  >
                                    <span>${label}</span>
                                    <span
                                      class="cpk-playground-reasoning-chevron transition-transform duration-200 [&>svg]:h-3 [&>svg]:w-3"
                                      >${this.renderIcon("ChevronRight")}</span
                                    >
                                  </summary>
                                  <div class="pb-2 pt-1 leading-5 text-gray-500">
                                    ${content}
                                  </div>
                                </details>
                              `
                            : html`
                                <div
                                  class="cpk-playground-message-enter my-1 py-1 text-[11px] font-medium text-gray-500"
                                  data-playground-message-role="reasoning"
                                >
                                  ${label}
                                </div>
                              `;
                        }
                        const isMultiline =
                          content.includes("\n") || content.length > 72;
                        const copyKey = `playground-message-${
                          message.id ?? index
                        }`;
                        const showToolbar =
                          !isUser &&
                          !isActivity &&
                          Boolean(content) &&
                          !(
                            this.playgroundIsRunning &&
                            index === lastAssistantIndex
                          );
                        return html`
                          <article
                            class=${
                              isActivity
                                ? "cpk-playground-message-enter mr-auto mt-3 flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[10px] text-gray-600"
                                : isUser
                                  ? "cpk-playground-message-enter flex w-full flex-col items-end pt-8"
                                  : "cpk-playground-message-enter w-full"
                            }
                            data-playground-message-role=${message.role}
                          >
                            ${
                              isActivity
                                ? html`
                                    <span class="text-gray-500"
                                      >${this.renderIcon("Activity")}</span
                                    >
                                    <span class="font-medium text-gray-700"
                                      >Activity</span
                                    >
                                    <span class="truncate">${content}</span>
                                  `
                                : isUser
                                  ? html`
                                      <div
                                        class=${`max-w-[80%] whitespace-pre-wrap break-words rounded-[16px] bg-gray-100 px-3 text-[13px] leading-5 text-gray-900 ${
                                          isMultiline ? "py-2.5" : "py-1"
                                        }`}
                                      >${content}</div>
                                    `
                                  : html`
                                      <div
                                        class="whitespace-pre-wrap break-words py-3 text-[13px] leading-[22px] text-gray-800"
                                      >${content}</div>
                                    `
                            }
                            ${
                              !isUser && message.toolCalls.length > 0
                                ? this.renderToolCallDetails(message.toolCalls)
                                : nothing
                            }
                            ${
                              showToolbar
                                ? html`
                                    <div
                                      class="-ml-1 flex min-h-7 w-full items-center gap-1 bg-transparent"
                                      data-playground-assistant-toolbar
                                    >
                                      <button
                                        type="button"
                                        class="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1 [&>svg]:h-3.5 [&>svg]:w-3.5"
                                        title="Copy message"
                                        aria-label="Copy message"
                                        @click=${(event: Event) =>
                                          this.copyToClipboard(
                                            content,
                                            copyKey,
                                            event,
                                          )}
                                      >
                                        ${
                                          this.copiedEvents.has(copyKey)
                                            ? this.renderIcon("Check")
                                            : this.renderIcon("Copy")
                                        }
                                      </button>
                                      ${
                                        index === lastAssistantIndex &&
                                        hasRetry &&
                                        !busy &&
                                        !this.playgroundError
                                          ? html`
                                              <button
                                                type="button"
                                                class="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1 [&>svg]:h-3.5 [&>svg]:w-3.5"
                                                title="Retry last prompt"
                                                aria-label="Retry last prompt"
                                                @click=${
                                                  this.handlePlaygroundRetry
                                                }
                                              >
                                                ${this.renderIcon("RotateCcw")}
                                              </button>
                                            `
                                          : nothing
                                      }
                                    </div>
                                  `
                                : nothing
                            }
                          </article>
                        `;
                      })}
                      ${
                        this.playgroundIsRunning && lastReasoningIndex < 0
                          ? html`
                              <div
                                class="cpk-playground-message-enter mt-3 flex items-center gap-1 px-1 py-1"
                                aria-label="Agent is working"
                              >
                                <span
                                  class="cpk-playground-thinking-dot h-1.5 w-1.5 rounded-full bg-gray-500"
                                ></span>
                                <span
                                  class="cpk-playground-thinking-dot h-1.5 w-1.5 rounded-full bg-gray-500"
                                ></span>
                                <span
                                  class="cpk-playground-thinking-dot h-1.5 w-1.5 rounded-full bg-gray-500"
                                ></span>
                              </div>
                            `
                          : nothing
                      }
                      ${
                        !busy &&
                        lastAssistantIndex >= 0 &&
                        suggestions.length > 0
                          ? html`
                              <div
                                class="mt-3 flex flex-wrap items-center gap-1.5"
                                data-playground-suggestions
                              >
                                ${suggestions.map(
                                  (suggestion) => html`
                                    <button
                                      type="button"
                                      class="inline-flex h-7 items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 text-[10px] font-medium leading-none text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-gray-500"
                                      ?disabled=${suggestion.isLoading}
                                      aria-busy=${
                                        suggestion.isLoading ? "true" : "false"
                                      }
                                      @click=${() =>
                                        this.handlePlaygroundSuggestion(
                                          suggestion.message,
                                        )}
                                    >
                                      ${
                                        suggestion.isLoading
                                          ? html`<span
                                              class="[&>svg]:animate-spin"
                                              aria-hidden="true"
                                              >${this.renderIcon(
                                                "LoaderCircle",
                                              )}</span
                                            >`
                                          : nothing
                                      }
                                      <span>${suggestion.title}</span>
                                    </button>
                                  `,
                                )}
                              </div>
                            `
                          : nothing
                      }
                    </div>
                  `
          }
        </div>

        ${
          showWelcome
            ? nothing
            : this.renderPlaygroundComposer(agentId, busy, hasRetry)
        }
      </div>
    `;
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

  // Fires `whats_new_clicked` at most once per `${bannerId}:${cta}` per mount
  // so copy-button retries and accidental multi-clicks don't inflate funnel
  // counts. `body` is the only cta left now that dismissal is gone.
  private trackWhatsNewClickedOnce(opts: { cta: "body" }): void {
    if (
      this.runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected ||
      this.core?.telemetryDisabled
    ) {
      return;
    }
    const id = this.announcementTimestamp;
    if (!id) return;
    const key = `${id}:${opts.cta}`;
    if (this.clickedBannerIds.has(key)) return;
    this.clickedBannerIds.add(key);
    trackWhatsNewClicked({
      banner_id: id,
      cta: opts.cta,
      cta_label: this.announcementCtaLabel ?? undefined,
    });
  }

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
    this.threadDividerResizing = true;
    this.threadDividerPointerId = event.pointerId;
    this.threadDividerStartX = event.clientX;
    this.threadDividerStartWidth = this.threadListWidth;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private handleThreadDividerPointerMove = (event: PointerEvent) => {
    if (
      !this.threadDividerResizing ||
      this.threadDividerPointerId !== event.pointerId
    )
      return;
    const delta = event.clientX - this.threadDividerStartX;
    this.threadListWidth = Math.max(
      180,
      Math.min(480, this.threadDividerStartWidth + delta),
    );
    this.requestUpdate();
  };

  private handleThreadDividerPointerUp = (event: PointerEvent) => {
    if (this.threadDividerPointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this.threadDividerPointerId)) {
      target.releasePointerCapture(this.threadDividerPointerId);
    }
    this.threadDividerResizing = false;
  };

  private trackThreadsViewStateOnce(
    state: "locked" | "empty_enabled" | "enabled",
  ): void {
    if (this.core?.telemetryDisabled) return;
    const key = `${state}:${this.getThreadServiceStatus()}`;
    if (this.viewedThreadsTelemetryStates.has(key)) return;
    this.viewedThreadsTelemetryStates.add(key);
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
    return (
      locked ||
      (!threadsErrorMessage && !threadsLoading && displayThreads.length === 0)
    );
  }

  private isExampleThreadId(threadId: string | null | undefined): boolean {
    return THREADS_EXAMPLE_THREADS.some((thread) => thread.id === threadId);
  }

  private getExampleThreadProvider(threadId: string): ThreadDebuggerProvider {
    const cached = this.exampleThreadProviders.get(threadId);
    if (cached) return cached;
    const thread = THREADS_EXAMPLE_THREADS.find((item) => item.id === threadId);
    const details = THREADS_EXAMPLE_DETAILS[threadId];
    const provider: ThreadDebuggerProvider = {
      getThreadMetadata: async () =>
        thread
          ? {
              id: thread.id,
              name: thread.name,
              agentId: thread.agentId,
              endUserId: "example-user",
              status: "completed",
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
            }
          : null,
      getMessages: async () => details?.messages ?? [],
      getEvents: async () => details?.events ?? [],
      getState: async () => details?.state ?? null,
    };
    this.exampleThreadProviders.set(threadId, provider);
    return provider;
  }

  private trackThreadsExampleViewedOnce(): void {
    if (this.core?.telemetryDisabled) return;
    for (const thread of THREADS_EXAMPLE_THREADS) {
      const exampleKind = getExampleKind(thread.id);
      if (!exampleKind || this.viewedExampleKinds.has(exampleKind)) continue;
      this.viewedExampleKinds.add(exampleKind);
      trackThreadsExampleViewed({
        ...this.getThreadsTelemetryProps(),
        example_kind: exampleKind,
      });
    }
  }

  private trackThreadsExampleSelectedOnce(threadId: string): void {
    if (this.core?.telemetryDisabled) return;
    const exampleKind = getExampleKind(threadId);
    if (!exampleKind || this.selectedExampleKinds.has(exampleKind)) return;
    this.selectedExampleKinds.add(exampleKind);
    trackThreadsExampleSelected({
      ...this.getThreadsTelemetryProps(),
      example_kind: exampleKind,
    });
  }

  private subscribeToInspectorThreadBridge(): void {
    this.unsubscribeFromInspectorThreadBridge();
    if (!isInspectorThreadBridgeEnabled()) return;
    this.inspectorBridgeUnsubscribers.push(
      onInspectorActiveThread((payload) => {
        if (payload.requestId !== this.activeViewInAppRequestId) return;
        this.inAppThreadId = payload.threadId;
        this.inAppAgentId = payload.agentId;
        this.inAppSource = payload.source;
        if (payload.source === "app") {
          this.activeViewInAppRequestId = null;
          this.viewInAppError = null;
        }
        this.requestUpdate();
      }),
      onInspectorViewThreadResult((payload) => {
        if (payload.requestId !== this.activeViewInAppRequestId) return;
        if (payload.ok) {
          this.viewInAppError = null;
          this.inAppThreadId = payload.threadId;
          this.inAppAgentId = payload.agentId;
          this.inAppSource = "override";
        } else {
          this.activeViewInAppRequestId = null;
          this.inAppThreadId = null;
          this.inAppAgentId = null;
          this.inAppSource = null;
          this.viewInAppError =
            "The app could not load that thread. The previous chat is back.";
        }
        this.requestUpdate();
      }),
    );
  }

  private unsubscribeFromInspectorThreadBridge(): void {
    for (const unsubscribe of this.inspectorBridgeUnsubscribers) {
      unsubscribe();
    }
    this.inspectorBridgeUnsubscribers = [];
  }

  private getViewInAppMode(
    thread: ɵThread | null,
    isExample: boolean,
  ): "hidden" | "view" | "stop" {
    if (!isInspectorThreadBridgeEnabled()) return "hidden";
    if (!thread || isExample) return "hidden";
    if (
      this.activeViewInAppRequestId &&
      this.inAppSource === "override" &&
      this.inAppThreadId === thread.id
    ) {
      return "stop";
    }
    return "view";
  }

  private handleViewInApp = (): void => {
    const thread = this.getSelectedRealThread();
    if (!thread) return;
    if (this.activeViewInAppRequestId && this.inAppAgentId) {
      emitInspectorStopViewing({
        requestId: this.activeViewInAppRequestId,
        agentId: this.inAppAgentId,
      });
    }
    this.viewInAppError = null;
    const requestId = createInspectorThreadRequestId();
    this.activeViewInAppRequestId = requestId;
    const handled = emitInspectorViewThread({
      requestId,
      threadId: thread.id,
      agentId: thread.agentId,
    });
    if (!handled) {
      this.activeViewInAppRequestId = null;
      this.inAppThreadId = null;
      this.inAppAgentId = null;
      this.inAppSource = null;
      this.viewInAppError = "No official chat for this agent is on the page.";
    }
    this.requestUpdate();
  };

  private handleStopViewing = (): void => {
    const requestId = this.activeViewInAppRequestId;
    const agentId = this.inAppAgentId;
    if (!requestId || !agentId) return;
    this.viewInAppError = null;
    emitInspectorStopViewing({ requestId, agentId });
    this.requestUpdate();
  };

  private getSelectedRealThread(): ɵThread | null {
    if (!this.selectedThreadId) return null;
    if (this.selectedThreadId === this.selectedLocalExampleThreadId) {
      return null;
    }
    return (
      this.getActiveThreadsState().displayThreads.find(
        (thread) => thread.id === this.selectedThreadId,
      ) ?? null
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
    const exampleKind = this.selectedThreadId
      ? getExampleKind(this.selectedThreadId)
      : undefined;
    const tourPair = getExampleTourTelemetryPair(this.exampleTourStep);
    if (!exampleKind || !tourPair) return undefined;
    return {
      ...this.getThreadsTelemetryProps(),
      example_kind: exampleKind,
      ...tourPair,
    };
  }

  private trackThreadsExampleTourStepViewedOnce(): void {
    if (this.core?.telemetryDisabled || !this.selectedThreadId) return;
    const props = this.getCurrentExampleTourProps();
    if (!props) return;
    const key = `${props.example_kind}:${props.tour_step}`;
    if (this.viewedExampleTourSteps.has(key)) return;
    this.viewedExampleTourSteps.add(key);
    trackThreadsExampleTourStepViewed(props);
  }

  private syncExampleTourTab(): void {
    const step =
      THREADS_EXAMPLE_TOUR_STEPS[this.exampleTourStep] ??
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
    if (!this.selectedThreadId) return;
    this.exampleTourActive = true;
    this.exampleTourStep = 0;
    if (autoStarted) {
      this.exampleTourAutoShown = true;
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
    const telemetryStepIsValid =
      getExampleTourTelemetryPair(nextStep) !== undefined;
    this.exampleTourStep = Math.max(
      0,
      Math.min(THREADS_EXAMPLE_TOUR_STEPS.length - 1, nextStep),
    );
    if (telemetryStepIsValid) this.trackThreadsExampleTourStepViewedOnce();
    this.syncExampleTourTab();
    this.requestUpdate();
  }

  private dismissExampleTour(method: "skip" | "done"): void {
    if (!this.selectedThreadId) return;
    this.exampleTourActive = false;
    this.exampleTourDismissed = true;
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
    this.requestedThreadId = null;
    this.focusedThreadMessageId = null;
    if (
      showingExamples &&
      this.selectedThreadId === threadId &&
      this.selectedLocalExampleThreadId === threadId
    ) {
      this.selectedThreadId = null;
      this.selectedRealThreadIsExplicit = false;
      this.selectedLocalExampleThreadId = null;
      this.exampleTourActive = false;
      this.requestUpdate();
      return;
    }

    this.selectedThreadId = threadId;
    if (showingExamples && this.isExampleThreadId(threadId)) {
      this.selectedRealThreadIsExplicit = false;
      this.selectedLocalExampleThreadId = threadId;
      this.trackThreadsExampleSelectedOnce(threadId);
      if (!this.exampleTourDismissed && !this.exampleTourAutoShown) {
        this.startExampleTour(true);
      } else {
        this.exampleTourActive = false;
      }
    } else {
      const { displayThreads } = this.getActiveThreadsState();
      this.selectedRealThreadIsExplicit = displayThreads.some(
        (thread) => thread.id === threadId,
      );
      this.selectedLocalExampleThreadId = null;
      this.exampleTourActive = false;
    }
    this.requestUpdate();
  }

  private readThreadsExampleTourDismissed(): boolean {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem(THREADS_EXAMPLE_TOUR_STORAGE_KEY);
      if (!raw) return false;
      const value = JSON.parse(raw) as { dismissed?: unknown };
      return value.dismissed === true;
    } catch {
      return false;
    }
  }

  private writeThreadsExampleTourDismissed(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        THREADS_EXAMPLE_TOUR_STORAGE_KEY,
        JSON.stringify({ dismissed: true }),
      );
    } catch {
      // Persistence is best-effort; the inspector should keep working without it.
    }
  }

  /** Cancels the one deferred gate without disturbing a newer lifecycle. */
  private cancelThreadsExampleOverviewVideoGate(): void {
    if (this.threadsExampleOverviewVideoLoadTimer !== null) {
      if (typeof window !== "undefined") {
        window.clearTimeout(this.threadsExampleOverviewVideoLoadTimer);
      }
      this.threadsExampleOverviewVideoLoadTimer = null;
    }
    if (this.threadsExampleOverviewVideoIdleCallbackId !== null) {
      if (
        typeof window !== "undefined" &&
        typeof window.cancelIdleCallback === "function"
      ) {
        window.cancelIdleCallback(
          this.threadsExampleOverviewVideoIdleCallbackId,
        );
      }
      this.threadsExampleOverviewVideoIdleCallbackId = null;
    }
  }

  /** Returns whether media work still belongs to the mounted lifecycle. */
  private isCurrentThreadsExampleOverviewVideo(
    video: HTMLVideoElement,
    lifecycleGeneration: number,
  ): boolean {
    return (
      this.isConnected &&
      video.isConnected &&
      this.threadsExampleOverviewVideoElement === video &&
      this.threadsExampleOverviewVideoLifecycleGeneration ===
        lifecycleGeneration
    );
  }

  /** Invalidates any unresolved play request without exposing another state. */
  private invalidateThreadsExampleOverviewVideoPlay(): void {
    this.threadsExampleOverviewVideoPlayAttemptGeneration += 1;
    this.threadsExampleOverviewVideoPlayPromise = null;
  }

  /** Moves a current media lifecycle into its readable failure state. */
  private failThreadsExampleOverviewVideo(
    video: HTMLVideoElement,
    lifecycleGeneration: number,
  ): void {
    if (
      !this.isCurrentThreadsExampleOverviewVideo(video, lifecycleGeneration)
    ) {
      return;
    }
    this.invalidateThreadsExampleOverviewVideoPlay();
    this.threadsExampleOverviewVideoLoaded = false;
    this.threadsExampleOverviewVideoState = "failed";
    this.requestUpdate();
  }

  /** Settles one guarded play promise and ignores stale completion. */
  private async settleThreadsExampleOverviewVideoPlay(
    video: HTMLVideoElement,
    lifecycleGeneration: number,
    playAttemptGeneration: number,
    playback: Promise<void>,
  ): Promise<void> {
    try {
      await playback;
      if (
        this.isCurrentThreadsExampleOverviewVideo(video, lifecycleGeneration) &&
        this.threadsExampleOverviewVideoPlayAttemptGeneration ===
          playAttemptGeneration &&
        this.threadsExampleOverviewVideoState !== "failed"
      ) {
        this.threadsExampleOverviewVideoState = "playing";
        this.requestUpdate();
      }
    } catch {
      if (
        this.isCurrentThreadsExampleOverviewVideo(video, lifecycleGeneration) &&
        this.threadsExampleOverviewVideoPlayAttemptGeneration ===
          playAttemptGeneration
      ) {
        this.failThreadsExampleOverviewVideo(video, lifecycleGeneration);
      }
    } finally {
      if (
        this.threadsExampleOverviewVideoPlayAttemptGeneration ===
        playAttemptGeneration
      ) {
        this.threadsExampleOverviewVideoPlayPromise = null;
      }
    }
  }

  /** Starts at most one play request for the current media lifecycle. */
  private playThreadsExampleOverviewVideo(
    video: HTMLVideoElement,
    lifecycleGeneration: number,
  ): void {
    if (
      this.threadsExampleOverviewVideoPlayPromise !== null ||
      this.threadsExampleOverviewVideoState === "deferred" ||
      this.threadsExampleOverviewVideoState === "failed" ||
      !this.isCurrentThreadsExampleOverviewVideo(video, lifecycleGeneration)
    ) {
      return;
    }

    const playAttemptGeneration =
      this.threadsExampleOverviewVideoPlayAttemptGeneration + 1;
    this.threadsExampleOverviewVideoPlayAttemptGeneration =
      playAttemptGeneration;
    try {
      const playback = Promise.resolve(video.play());
      this.threadsExampleOverviewVideoPlayPromise =
        this.settleThreadsExampleOverviewVideoPlay(
          video,
          lifecycleGeneration,
          playAttemptGeneration,
          playback,
        );
    } catch {
      this.failThreadsExampleOverviewVideo(video, lifecycleGeneration);
    }
  }

  /** Attaches the sole source for a generation and optionally starts playback. */
  private activateThreadsExampleOverviewVideo(
    video: HTMLVideoElement,
    lifecycleGeneration: number,
    play: boolean,
  ): void {
    if (
      this.threadsExampleOverviewVideoState !== "deferred" ||
      !this.isCurrentThreadsExampleOverviewVideo(video, lifecycleGeneration)
    ) {
      return;
    }

    this.threadsExampleOverviewVideoState = "ready";
    this.threadsExampleOverviewVideoLoaded = false;
    video.autoplay = !this.threadsExampleOverviewVideoReducedMotion;
    video.setAttribute("src", THREADS_EXAMPLE_OVERVIEW_VIDEO_URL);
    this.requestUpdate();
    if (play) {
      this.playThreadsExampleOverviewVideo(video, lifecycleGeneration);
    }
  }

  /** Schedules exactly one idle or timer gate for the current video. */
  private scheduleThreadsExampleOverviewVideoLoad(): void {
    const video = this.threadsExampleOverviewVideoElement;
    if (
      !video ||
      !this.isConnected ||
      this.threadsExampleOverviewVideoState !== "deferred" ||
      this.threadsExampleOverviewVideoLoadTimer !== null ||
      this.threadsExampleOverviewVideoIdleCallbackId !== null ||
      typeof window === "undefined"
    ) {
      return;
    }

    const lifecycleGeneration =
      this.threadsExampleOverviewVideoLifecycleGeneration;
    if (typeof window.requestIdleCallback === "function") {
      let idleCallbackId = 0;
      const loadVideo = () => {
        if (this.threadsExampleOverviewVideoIdleCallbackId !== idleCallbackId) {
          return;
        }
        this.threadsExampleOverviewVideoIdleCallbackId = null;
        this.activateThreadsExampleOverviewVideo(
          video,
          lifecycleGeneration,
          !this.threadsExampleOverviewVideoReducedMotion,
        );
      };
      idleCallbackId = window.requestIdleCallback(loadVideo, { timeout: 1200 });
      this.threadsExampleOverviewVideoIdleCallbackId = idleCallbackId;
      return;
    }

    const loadTimer = window.setTimeout(() => {
      if (this.threadsExampleOverviewVideoLoadTimer !== loadTimer) {
        return;
      }
      this.threadsExampleOverviewVideoLoadTimer = null;
      this.activateThreadsExampleOverviewVideo(
        video,
        lifecycleGeneration,
        !this.threadsExampleOverviewVideoReducedMotion,
      );
    }, 450);
    this.threadsExampleOverviewVideoLoadTimer = loadTimer;
  }

  /** Attaches one generation-scoped media listener set to the stable video. */
  private bindThreadsExampleOverviewVideo(video: HTMLVideoElement): void {
    const lifecycleGeneration =
      this.threadsExampleOverviewVideoLifecycleGeneration;
    const listeners: ThreadsExampleOverviewVideoListeners = {
      loadeddata: () => {
        if (
          !this.isCurrentThreadsExampleOverviewVideo(
            video,
            lifecycleGeneration,
          ) ||
          this.threadsExampleOverviewVideoState === "deferred" ||
          this.threadsExampleOverviewVideoState === "failed"
        ) {
          return;
        }
        this.threadsExampleOverviewVideoLoaded = true;
        this.requestUpdate();
      },
      play: () => {
        if (
          this.isCurrentThreadsExampleOverviewVideo(
            video,
            lifecycleGeneration,
          ) &&
          this.threadsExampleOverviewVideoState !== "deferred" &&
          this.threadsExampleOverviewVideoState !== "failed"
        ) {
          this.threadsExampleOverviewVideoState = "playing";
          this.requestUpdate();
        }
      },
      pause: () => {
        if (
          this.isCurrentThreadsExampleOverviewVideo(
            video,
            lifecycleGeneration,
          ) &&
          this.threadsExampleOverviewVideoState !== "deferred" &&
          this.threadsExampleOverviewVideoState !== "failed"
        ) {
          this.invalidateThreadsExampleOverviewVideoPlay();
          this.threadsExampleOverviewVideoState = "ready";
          this.requestUpdate();
        }
      },
      error: () => {
        this.failThreadsExampleOverviewVideo(video, lifecycleGeneration);
      },
    };
    this.threadsExampleOverviewVideoElement = video;
    this.threadsExampleOverviewVideoListeners = listeners;
    video.addEventListener("loadeddata", listeners.loadeddata);
    video.addEventListener("play", listeners.play);
    video.addEventListener("pause", listeners.pause);
    video.addEventListener("error", listeners.error);
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay =
      this.threadsExampleOverviewVideoState !== "deferred" &&
      !this.threadsExampleOverviewVideoReducedMotion;
  }

  /** Tears down gates, listeners, playback, and source in cleanup order. */
  private cleanupThreadsExampleOverviewVideo(): void {
    const video = this.threadsExampleOverviewVideoElement;
    if (video) {
      this.threadsExampleOverviewVideoLifecycleGeneration += 1;
    }
    this.invalidateThreadsExampleOverviewVideoPlay();
    this.cancelThreadsExampleOverviewVideoGate();
    this.threadsExampleOverviewVideoPlayOnNextBind = false;

    const listeners = this.threadsExampleOverviewVideoListeners;
    if (video && listeners) {
      video.removeEventListener("loadeddata", listeners.loadeddata);
      video.removeEventListener("play", listeners.play);
      video.removeEventListener("pause", listeners.pause);
      video.removeEventListener("error", listeners.error);
    }
    this.threadsExampleOverviewVideoElement = null;
    this.threadsExampleOverviewVideoListeners = null;

    if (video) {
      try {
        video.pause();
      } catch {
        // Some DOM shims expose media methods that throw instead of no-oping.
      }
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Cleanup must stay synchronous and never surface media abort errors.
      }
    }
    this.threadsExampleOverviewVideoLoaded = false;
    this.threadsExampleOverviewVideoState = "deferred";
  }

  /** Reconciles the rendered media node with its current lifecycle. */
  private syncThreadsExampleOverviewVideo(): void {
    const video = this.activeRoot.querySelector<HTMLVideoElement>(
      ".cpk-threads-overview-video",
    );
    if (!video) {
      if (
        this.threadsExampleOverviewVideoElement ||
        this.threadsExampleOverviewVideoState !== "deferred" ||
        this.threadsExampleOverviewVideoLoadTimer !== null ||
        this.threadsExampleOverviewVideoIdleCallbackId !== null ||
        this.threadsExampleOverviewVideoPlayOnNextBind
      ) {
        this.cleanupThreadsExampleOverviewVideo();
      }
      return;
    }

    if (this.threadsExampleOverviewVideoElement !== video) {
      if (this.threadsExampleOverviewVideoElement) {
        this.cleanupThreadsExampleOverviewVideo();
      }
      this.bindThreadsExampleOverviewVideo(video);
    }
    if (this.threadsExampleOverviewVideoPlayOnNextBind) {
      this.threadsExampleOverviewVideoPlayOnNextBind = false;
      this.activateThreadsExampleOverviewVideo(
        video,
        this.threadsExampleOverviewVideoLifecycleGeneration,
        true,
      );
      return;
    }
    this.scheduleThreadsExampleOverviewVideoLoad();
  }

  /** Handles the external native Play/Pause control. */
  private handleThreadsExampleOverviewVideoControl = (): void => {
    const video = this.threadsExampleOverviewVideoElement;
    if (!video) return;

    if (this.threadsExampleOverviewVideoState === "playing") {
      this.invalidateThreadsExampleOverviewVideoPlay();
      try {
        video.pause();
      } catch {
        // Keep the visible state usable when a media shim cannot pause.
      }
      this.threadsExampleOverviewVideoState = "ready";
      this.requestUpdate();
      return;
    }

    if (this.threadsExampleOverviewVideoState === "failed") {
      this.cleanupThreadsExampleOverviewVideo();
      if (!this.isConnected || !video.isConnected) return;
      this.threadsExampleOverviewVideoPlayOnNextBind = true;
      this.requestUpdate();
      return;
    }

    this.cancelThreadsExampleOverviewVideoGate();
    const lifecycleGeneration =
      this.threadsExampleOverviewVideoLifecycleGeneration;
    if (this.threadsExampleOverviewVideoState === "deferred") {
      this.activateThreadsExampleOverviewVideo(
        video,
        lifecycleGeneration,
        true,
      );
      return;
    }
    this.playThreadsExampleOverviewVideo(video, lifecycleGeneration);
  };

  private renderThreadsExampleOverviewVideo() {
    const isPlaying = this.threadsExampleOverviewVideoState === "playing";
    const sourceIsAttached =
      this.threadsExampleOverviewVideoState !== "deferred";
    const video = html`<video
      class="cpk-threads-overview-video"
      data-loaded=${this.threadsExampleOverviewVideoLoaded}
      ?autoplay=${
        sourceIsAttached && !this.threadsExampleOverviewVideoReducedMotion
      }
      .autoplay=${
        sourceIsAttached && !this.threadsExampleOverviewVideoReducedMotion
      }
      loop
      .loop=${true}
      muted
      .muted=${true}
      playsinline
      .playsInline=${true}
      preload="metadata"
    ></video>`;
    // Alternating template identities retire the prior media node after cleanup.
    // The node remains stable for every render within one lifecycle generation.
    const generationScopedVideo =
      this.threadsExampleOverviewVideoLifecycleGeneration % 2 === 0
        ? html`<!-- cpk-video-generation-even -->${video}`
        : html`<!-- cpk-video-generation-odd -->${video}`;
    return html`
      <div class="cpk-threads-overview-video-frame" aria-hidden="true">
        ${generationScopedVideo}
      </div>
      <button
        class="cpk-threads-overview-video-control"
        type="button"
        aria-pressed=${isPlaying ? "false" : "true"}
        @click=${this.handleThreadsExampleOverviewVideoControl}
      >
        ${isPlaying ? "Pause demo" : "Play demo"}
      </button>
      ${
        this.threadsExampleOverviewVideoState === "failed"
          ? html`
            <p class="cpk-threads-overview-video-fallback" role="status">
              ${THREADS_EXAMPLE_OVERVIEW_VIDEO_FALLBACK}
            </p>
          `
          : nothing
      }
    `;
  }

  /** Show a copy result briefly and announce it to assistive technology. */
  private showThreadsSetupPromptCopyState(
    state: Exclude<ThreadsSetupPromptCopyState, "idle">,
    generation: number,
  ): void {
    if (
      !this.isConnected ||
      generation !== this.threadsSetupPromptCopyGeneration
    ) {
      return;
    }
    if (this.threadsSetupPromptCopyResetTimeoutId !== null) {
      window.clearTimeout(this.threadsSetupPromptCopyResetTimeoutId);
    }
    this.threadsSetupPromptCopyState = state;
    this.requestUpdate();
    this.threadsSetupPromptCopyResetTimeoutId = window.setTimeout(() => {
      if (
        !this.isConnected ||
        generation !== this.threadsSetupPromptCopyGeneration
      ) {
        return;
      }
      this.threadsSetupPromptCopyState = "idle";
      this.threadsSetupPromptCopyResetTimeoutId = null;
      this.requestUpdate();
    }, 2_000);
  }

  /** Copy the static, docs-backed Rich Threads repair prompt. */
  private handleThreadsSetupPromptCopy = async (
    event?: Event,
  ): Promise<void> => {
    const generation = (this.threadsSetupPromptCopyGeneration += 1);
    if (this.threadsSetupPromptCopyResetTimeoutId !== null) {
      window.clearTimeout(this.threadsSetupPromptCopyResetTimeoutId);
      this.threadsSetupPromptCopyResetTimeoutId = null;
    }
    this.threadsSetupPromptCopyState = "idle";
    this.requestUpdate();

    const clipboard = this.getClipboard(event);
    if (!clipboard?.writeText) {
      this.showThreadsSetupPromptCopyState("error", generation);
      return;
    }

    try {
      await clipboard.writeText(THREADS_RUNTIME_SETUP_PROMPT);
      this.showThreadsSetupPromptCopyState("copied", generation);
    } catch {
      this.showThreadsSetupPromptCopyState("error", generation);
    }
  };

  private renderThreadsExampleOverview(locked: boolean) {
    const lockedCopy = locked ? this.getThreadsLockedCopy() : undefined;
    const { lockedAction } = this.inspectorMetadataProjection;
    const onboardingAction = this.getThreadsEmptyOnboardingAction();
    return html`
      <div class="cpk-threads-overview">
        <div class="cpk-threads-overview-content">
          <h2 class="cpk-threads-overview-title">
            ${
              lockedCopy?.heading ??
              "Threads are persistent, inspectable conversations"
            }
          </h2>
          ${this.renderThreadsExampleOverviewVideo()}
          <p class="cpk-threads-overview-copy">
            ${
              lockedCopy?.description ??
              "Take a tour with the example threads in the sidebar. Then, start chatting in your app to create the first real thread."
            }
          </p>
          <div class="cpk-threads-overview-actions">
            ${
              locked
                ? html`
                  ${
                    this.inspectorMetadataProjection.licenseState === "valid"
                      ? html`
                        <button
                          data-inspector-threads-setup-prompt
                          type="button"
                          aria-label=${
                            this.threadsSetupPromptCopyState === "copied"
                              ? "Setup prompt copied"
                              : this.threadsSetupPromptCopyState === "error"
                                ? "Copy setup prompt failed. Try again"
                                : "Copy setup prompt for your coding agent"
                          }
                          @click=${this.handleThreadsSetupPromptCopy}
                        >
                          ${this.renderIcon(
                            this.threadsSetupPromptCopyState === "copied"
                              ? "Check"
                              : "Copy",
                          )}
                          ${
                            this.threadsSetupPromptCopyState === "copied"
                              ? "Copied"
                              : this.threadsSetupPromptCopyState === "error"
                                ? "Copy blocked"
                                : "Copy prompt for your agent"
                          }
                        </button>
                        <a
                          data-inspector-threads-setup-link
                          href=${this.getThreadsRuntimeSetupDocsUrl()}
                          target="_blank"
                          rel="noopener"
                          aria-label="Open setup guide (opens in a new tab)"
                        >
                          Open setup guide
                        </a>
                        <span
                          class="sr-only"
                          data-inspector-threads-setup-copy-status
                          aria-live="polite"
                          >${
                            this.threadsSetupPromptCopyState === "copied"
                              ? "Setup prompt copied."
                              : this.threadsSetupPromptCopyState === "error"
                                ? "Setup prompt copy failed. Open the setup guide and copy it manually."
                                : ""
                          }</span
                        >
                      `
                      : nothing
                  }
                  ${
                    lockedAction
                      ? this.renderInspectorAction(lockedAction, "locked")
                      : nothing
                  }
                `
                : html`
                  <a
                    href=${this.getThreadsDocsUrl()}
                    target="_blank"
                    rel="noopener"
                    class="cpk-threads-overview-action cpk-threads-overview-action-primary"
                  >
                    Learn how Threads work
                  </a>
                  <a
                    href=${onboardingAction.href}
                    target="_blank"
                    rel="noopener"
                    class="cpk-threads-overview-action cpk-threads-overview-action-secondary"
                  >
                    ${onboardingAction.label}
                  </a>
                `
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderThreadsExampleTour() {
    if (
      !this.selectedThreadId ||
      this.selectedThreadId !== this.selectedLocalExampleThreadId
    ) {
      return nothing;
    }

    if (!this.exampleTourActive) {
      return html`
        <button
          class="cpk-threads-tour-launch"
          type="button"
          @click=${() => this.startExampleTour(false)}
        >
          Show tour
        </button>
      `;
    }

    const step =
      THREADS_EXAMPLE_TOUR_STEPS[this.exampleTourStep] ??
      THREADS_EXAMPLE_TOUR_STEPS[0]!;
    const isFirst = this.exampleTourStep === 0;
    const isLast =
      this.exampleTourStep === THREADS_EXAMPLE_TOUR_STEPS.length - 1;

    return html`
      <div
        class="cpk-threads-tour"
        role="dialog"
        aria-label="Example thread tour"
      >
        <div class="cpk-threads-tour-step">
          ${this.exampleTourStep + 1}/${THREADS_EXAMPLE_TOUR_STEPS.length}
          ${step.label}
        </div>
        <div class="cpk-threads-tour-title">${step.title}</div>
        <div class="cpk-threads-tour-copy">${step.body}</div>
        <div class="cpk-threads-tour-actions">
          <button
            class="cpk-threads-tour-skip"
            type="button"
            @click=${() => this.dismissExampleTour("skip")}
          >
            Skip
          </button>
          <div class="cpk-threads-tour-nav">
            <button
              class="cpk-threads-tour-button cpk-threads-tour-button-secondary"
              type="button"
              ?disabled=${isFirst}
              @click=${() => this.setExampleTourStep(this.exampleTourStep - 1)}
            >
              Back
            </button>
            <button
              class="cpk-threads-tour-button cpk-threads-tour-button-primary"
              type="button"
              @click=${() =>
                isLast
                  ? this.dismissExampleTour("done")
                  : this.setExampleTourStep(this.exampleTourStep + 1)}
            >
              ${isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderThreadsLockedBackgroundMockup() {
    const threadRows = [
      { width: 74, accent: true },
      { width: 92 },
      { width: 68 },
      { width: 84 },
      { width: 58 },
      { width: 76 },
    ];

    return html`
      <div aria-hidden="true" class="cpk-locked-preview">
        <div class="cpk-locked-preview-sidebar">
          ${threadRows.map(
            (row) => html`
              <div
                class="cpk-locked-preview-row"
                data-accent=${row.accent ? "true" : "false"}
              >
                <div
                  class="cpk-locked-preview-bar cpk-locked-preview-row-title"
                  style="--preview-width: ${row.width}%;"
                ></div>
                <div
                  class="cpk-locked-preview-bar cpk-locked-preview-row-line"
                ></div>
                <div
                  class="cpk-locked-preview-bar cpk-locked-preview-row-line"
                ></div>
              </div>
            `,
          )}
        </div>
        <div class="cpk-locked-preview-main">
          <div class="cpk-locked-preview-bar cpk-locked-preview-heading"></div>
          <div class="cpk-locked-preview-bar cpk-locked-preview-copy"></div>
          <div class="cpk-locked-preview-bar cpk-locked-preview-copy"></div>
          <div class="cpk-locked-preview-cards">
            <div class="cpk-locked-preview-card"></div>
            <div class="cpk-locked-preview-card"></div>
          </div>
          <div
            class="cpk-locked-preview-bar cpk-locked-preview-footer-line"
          ></div>
          <div
            class="cpk-locked-preview-bar cpk-locked-preview-footer-line"
          ></div>
        </div>
      </div>
    `;
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
   * Renders the realtime-connection indicator in the memory-store header.
   * Only `"connected"` shows the live (green-dot) state; `"connecting"` shows a
   * muted amber "reconnecting" and `"unavailable"` a muted grey "offline", so
   * the indicator never claims "live" over a frozen snapshot once the realtime
   * socket has permanently given up.
   */
  private renderMemoryRealtimeIndicator() {
    const status = this._memoriesRealtimeStatus;
    const connected = status === "connected";
    const dotColor = connected
      ? "#22c55e"
      : status === "connecting"
        ? "#f59e0b"
        : "#9ca3af";
    const label =
      status === "connected"
        ? "live"
        : status === "connecting"
          ? "reconnecting"
          : "offline";
    return html`
      <span
        style="
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 500;
          color: ${connected ? "#57575b" : "#68686e"};
        "
      >
        <span
          style="
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: ${dotColor};
          "
        ></span>
        ${label}
      </span>
    `;
  }

  private renderMemoriesView() {
    // 1. Locked teaser — intelligence not configured or memories not available.
    if (!this.core?.intelligence || !this._memoriesAvailable) {
      return html`
        <div class="cpk-memory-locked">
          ${this.renderThreadsLockedBackgroundMockup()}
          <div aria-hidden="true" class="cpk-memory-locked-scrim"></div>
          <div class="cpk-memory-locked-content">
            <div aria-hidden="true" class="cpk-memory-locked-icon-wrap">
              <div class="cpk-memory-locked-icon">
                ${this.renderIcon("Lock")}
              </div>
            </div>
            <h2 class="cpk-memory-locked-title">Learning</h2>
            <p class="cpk-memory-locked-copy">
              ${
                this._memoryStoreUnsupported
                  ? "Learning is unavailable in this version of the @copilotkit SDK. Upgrade @copilotkit/core (and @copilotkit/react) to a version that supports long-term memory."
                  : "Learning turns durable information from agent interactions into reusable context. It isn't enabled on this deployment."
              }
            </p>
            <div class="cpk-memory-locked-actions">
              <a
                href=${this.getTalkToEngineerUrl()}
                target="_blank"
                rel="noopener"
                class="cpk-memory-locked-action"
                @click=${this.handleThreadsTalkToEngineerClick}
              >
                Talk to an Engineer
              </a>
              <a
                href=${this.getIntelligenceSignupUrl()}
                target="_blank"
                rel="noopener"
                class="cpk-memory-locked-action cpk-memory-locked-action-secondary"
                @click=${this.handleThreadsIntelligenceSignupClick}
              >
                Sign up for Intelligence
              </a>
            </div>
          </div>
        </div>
      `;
    }

    // 2. Full-screen error — only for a snapshot-LOAD failure (no memories
    // loaded). A mutation failure that arrives while memories are already on
    // screen must NOT blank the list; it is surfaced inline below (step 4).
    if (this._memoriesError && this._memories.length === 0) {
      return html`
        <div
          style="
            display: flex;
            height: 100%;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: #68686e;
          "
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c0333a"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style="font-size: 13px; color: #c0333a;">
            ${MEMORY_LOAD_ERROR_LABEL}
          </span>
          <span
            style="
              max-width: 320px;
              text-align: center;
              font-size: 11px;
              line-height: 1.5;
              color: #c0333a;
            "
          >
            ${this._memoriesError.message}
          </span>
          <span
            style="
              max-width: 320px;
              text-align: center;
              font-size: 11px;
              line-height: 1.5;
              color: #c0333a;
            "
          >
            ${EVENT_ERROR_GUIDANCE.memory.advice}
          </span>
        </div>
      `;
    }

    // 3. Initial loading placeholder (no memories yet to show behind it).
    if (this._memoriesLoading && this._memories.length === 0) {
      return html`
        <div
          style="
            display: flex;
            height: 100%;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: #68686e;
          "
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c0c0c8"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span style="font-size: 13px">Loading learning…</span>
        </div>
      `;
    }

    // 4. Content — header + memory list.
    return html`
      <div
        style="display:flex;height:100%;overflow:hidden;flex-direction:column;"
      >
        <div
          class="cpk-section-header"
          style="display:flex;align-items:center;justify-content:space-between;"
        >
          <h4>${LEARNING_VIEW_LABEL}</h4>
          <div style="display:flex;align-items:center;gap:6px;">
            ${this.renderMemoryRealtimeIndicator()}
            <span
              style="
                font-size: 11px;
                font-weight: 500;
                color: #57575b;
                background: rgba(0,0,0,0.07);
                border-radius: 9999px;
                padding: 1px 7px;
              "
            >
              ${this._memories.length}
            </span>
          </div>
        </div>
        ${
          this._memoriesError
            ? html`
              <div
                role="alert"
                style="
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    flex-shrink: 0;
                    border-bottom: 1px solid #f1c7c9;
                    background: #fdf3f3;
                    padding: 8px 12px;
                    color: #c0333a;
                    font-size: 12px;
                    line-height: 1.45;
                  "
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#c0333a"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  style="flex-shrink:0;margin-top:1px;"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>Action failed: ${this._memoriesError.message}</span>
              </div>
            `
            : nothing
        }
        <div style="flex:1;min-height:0;overflow:hidden;">
          <cpk-memory-list
            style="height:100%;"
            data-color-scheme=${this.colorScheme}
            .memories=${this._memories}
            .recallResults=${this._recallResults}
            .recallLoading=${this._recallLoading}
            .recallError=${this._recallError}
            .recallQueryText=${this._recallQuery}
            @recallQueryChanged=${(e: CustomEvent<string>) => {
              this._recallQuery = e.detail;
            }}
            @recallSubmitted=${(e: CustomEvent<string>) => {
              this.runRecall(e.detail);
            }}
            @recallCleared=${() => {
              this.clearRecall();
            }}
          ></cpk-memory-list>
        </div>
      </div>
    `;
  }

  /** Renders trusted Threads usage and its independent plan action. */
  private renderThreadsUsageFooter() {
    const { usage, threadsFooterAction } = this.inspectorMetadataProjection;
    if (!usage && !threadsFooterAction) {
      return nothing;
    }

    let countLabel: string | undefined;
    let progressMax: number | undefined;
    let progressValue: number | undefined;
    const capacityState = this.getThreadsCapacityState();
    if (usage) {
      if (usage.limit.kind === "finite") {
        const overLimit = usage.used > usage.limit.value;
        const visibleUsed = overLimit
          ? `${usage.limit.value}+`
          : String(usage.used);
        countLabel = `${visibleUsed} / ${usage.limit.value} Threads`;
        progressMax = usage.limit.value;
        progressValue = Math.min(usage.used, usage.limit.value);
      } else if (usage.limit.kind === "unlimited") {
        countLabel = `${usage.used} Threads · Unlimited`;
      } else {
        countLabel = `${usage.used} Threads · Limit unavailable`;
      }
    }

    return html`
      <footer
        class="inspector-threads-footer"
        data-inspector-threads-footer
        role="group"
        aria-label="Threads usage"
      >
        ${
          usage && countLabel
            ? html`
              <div class="inspector-threads-usage">
                <span data-inspector-thread-count>${countLabel}</span>
                ${
                  progressMax !== undefined && progressValue !== undefined
                    ? html`
                      <progress
                        class="inspector-thread-progress"
                        data-inspector-thread-progress
                        data-inspector-thread-capacity=${capacityState}
                        max=${progressMax}
                        value=${progressValue}
                        aria-label=${
                          capacityState === "warning"
                            ? `${countLabel}. Near thread limit.`
                            : capacityState === "critical"
                              ? `${countLabel}. Thread limit reached.`
                              : countLabel
                        }
                      >
                        ${countLabel}
                      </progress>
                    `
                    : nothing
                }
                ${
                  usage.expiringSoonCount !== undefined
                    ? html`
                      <span data-inspector-thread-expiry
                        >${usage.expiringSoonCount} Expiring Soon</span
                      >
                    `
                    : nothing
                }
              </div>
            `
            : nothing
        }
        ${
          threadsFooterAction
            ? this.renderInspectorAction(
                threadsFooterAction,
                "threads-footer",
                capacityState === "warning" || capacityState === "critical"
                  ? "Upgrade Your Plan"
                  : threadsFooterAction.label,
              )
            : nothing
        }
      </footer>
    `;
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
      this.selectedThreadId != null
        ? (visibleThreads.find((t) => t.id === this.selectedThreadId) ?? null)
        : null;
    const selectedThreadIsLocalExample =
      selectedThread !== null &&
      selectedThread.id === this.selectedLocalExampleThreadId;

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

    return html`
      <div
        style="display:flex;height:100%;overflow:hidden;flex-direction:column;"
      >
        <div style="display:flex;min-height:0;flex:1;overflow:hidden;">
          <!-- Left sidebar: thread list -->
          <div
            style="width:${
              this.threadListWidth
            }px;flex-shrink:0;overflow:hidden;display:flex;flex-direction:column;border-right:1px solid #DBDBE5;"
          >
            <cpk-thread-list
              style="min-height:0;flex:1;"
              data-color-scheme=${this.colorScheme}
              .threads=${visibleThreads}
              .selectedThreadId=${this.selectedThreadId}
              .inAppThreadId=${this.inAppThreadId}
              .errorMessage=${threadsErrorMessage}
              .suppressEmptyState=${loadingWithoutRows}
              @threadSelected=${(e: CustomEvent<string>) => {
                this.handleThreadsThreadSelected(e.detail, showingExamples);
              }}
            ></cpk-thread-list>
            ${this.renderThreadsUsageFooter()}
          </div>

          <!-- Resize divider -->
          <div
            style="width:4px;flex-shrink:0;cursor:col-resize;background:transparent;position:relative;z-index:1;"
            @pointerdown=${this.handleThreadDividerPointerDown}
            @pointermove=${this.handleThreadDividerPointerMove}
            @pointerup=${this.handleThreadDividerPointerUp}
            @pointercancel=${this.handleThreadDividerPointerUp}
          ></div>

          <!-- Center + right: thread details or empty state -->
          <div
            style="flex:1;min-width:0;overflow:hidden;display:flex;position:relative;"
          >
            ${
              !locked && threadsErrorMessage
                ? html`
                  <div
                    role="alert"
                    style="
                        display: flex;
                        flex: 1;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                        padding: 24px;
                        color: #c0333a;
                        text-align: center;
                      "
                  >
                    <strong style="font-size:13px;"
                      >Failed to load threads</strong
                    >
                    <span
                      style="max-width:440px;font-size:12px;line-height:1.5;"
                      >${threadsErrorMessage}</span
                    >
                  </div>
                `
                : loadingWithoutRows
                  ? html`
                      <div
                        role="status"
                        style="
                          display: flex;
                          flex: 1;
                          align-items: center;
                          justify-content: center;
                          color: #57575b;
                          font-size: 13px;
                        "
                      >
                        Loading threads…
                      </div>
                    `
                  : selectedThread
                    ? html`<cpk-thread-details
                        style="flex:1;min-width:0;"
                        data-color-scheme=${this.colorScheme}
                        .threadId=${selectedThread.id}
                        .thread=${selectedThread}
                        .provider=${
                          selectedThreadIsLocalExample
                            ? this.getExampleThreadProvider(selectedThread.id)
                            : null
                        }
                        .runtimeUrl=${
                          selectedThreadIsLocalExample
                            ? ""
                            : (this._core?.runtimeUrl ?? "")
                        }
                        .headers=${this._core?.headers ?? {}}
                        .threadInspectionAvailable=${
                          selectedThreadIsLocalExample ||
                          (this.areThreadEndpointsAvailable() &&
                            this._core?.threadEndpoints?.inspect !== false)
                        }
                        .liveMessageVersion=${
                          this.liveMessageVersion.get(selectedThread.id) ?? 0
                        }
                        .viewInAppMode=${this.getViewInAppMode(
                          selectedThread,
                          selectedThreadIsLocalExample,
                        )}
                        .viewInAppError=${this.viewInAppError}
                        @viewInApp=${this.handleViewInApp}
                        @stopViewing=${this.handleStopViewing}
                        .focusMessageId=${this.focusedThreadMessageId}
                        .focusRequestId=${this.threadFocusRequestId}
                        .agentStateInput=${this.getLatestStateForAgent(
                          selectedThread.agentId,
                        )}
                        .agentEventsInput=${
                          this.agentEvents.get(selectedThread.agentId) ?? []
                        }
                      ></cpk-thread-details>
                      ${
                        selectedThreadIsLocalExample
                          ? this.renderThreadsExampleTour()
                          : nothing
                      }`
                    : showingExamples
                      ? this.renderThreadsExampleOverview(locked)
                      : html`
                        <div
                          style="
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        color: #68686e;
                      "
                        >
                          <svg
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#c0c0c8"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path
                              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                            />
                          </svg>
                          <span style="font-size: 13px"
                            >${
                              displayThreads.length === 0
                                ? "No threads yet"
                                : "Select a thread to inspect"
                            }</span
                          >
                        </div>
                      `
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderEventsToolbar(
    events: InspectorEvent[],
    filteredEvents: InspectorEvent[],
    options: { showAgentFilter?: boolean } = {},
  ) {
    const showAgentFilter = options.showAgentFilter !== false;
    const selectedLabel =
      this.selectedContext === "all-agents"
        ? "all agents"
        : `agent ${this.selectedContext}`;

    return html`
      <div
        class="flex flex-col gap-1.5 border-b border-gray-200 bg-white px-4 py-2.5"
      >
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative min-w-[200px] flex-1">
            <input
              type="search"
              class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-[11px] text-gray-700 shadow-sm outline-none ring-1 ring-transparent transition focus:border-gray-300 focus:ring-gray-200"
              placeholder="Search agent, type, payload"
              .value=${this.eventFilterText}
              @input=${this.handleEventFilterInput}
            />
          </div>
          ${
            showAgentFilter
              ? html`
                <select
                  class="w-40 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 shadow-sm outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  .value=${this.selectedContext}
                  @change=${this.handleEventAgentChange}
                  aria-label="Filter events by agent"
                >
                  ${this.contextOptions.map(
                    (option) =>
                      html`<option value=${option.key}>
                        ${option.label}
                      </option>`,
                  )}
                </select>
              `
              : nothing
          }
          <select
            class="w-40 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 shadow-sm outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
            .value=${this.eventTypeFilter}
            @change=${this.handleEventTypeChange}
            aria-label="Filter events by type"
          >
            <option value="all">All event types</option>
            ${AGENT_EVENT_TYPES.map(
              (type) =>
                html`<option value=${type}>
                  ${type.toLowerCase().replace(/_/g, " ")}
                </option>`,
            )}
          </select>
          <div class="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              class="tooltip-target flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Reset filters"
              data-tooltip="Reset filters"
              aria-label="Reset filters"
              @click=${this.resetEventFilters}
              ?disabled=${
                !this.eventFilterText && this.eventTypeFilter === "all"
              }
            >
              ${this.renderIcon("RotateCw")}
            </button>
            <button
              type="button"
              class="tooltip-target flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Export JSON"
              data-tooltip="Export JSON"
              aria-label="Export JSON"
              @click=${() => this.exportEvents(filteredEvents)}
              ?disabled=${filteredEvents.length === 0}
            >
              ${this.renderIcon("Download")}
            </button>
            <button
              type="button"
              class="tooltip-target flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Clear events"
              data-tooltip="Clear events"
              aria-label="Clear events"
              @click=${this.handleClearEvents}
              ?disabled=${events.length === 0}
            >
              ${this.renderIcon("Trash2")}
            </button>
          </div>
        </div>
        <div class="text-[11px] text-gray-500">
          Showing ${filteredEvents.length} of
          ${events.length}${
            this.selectedContext === "all-agents" ? "" : ` for ${selectedLabel}`
          }
        </div>
      </div>
    `;
  }

  private renderEventsTable(options: { embedded?: boolean } = {}) {
    const events = this.getEventsForSelectedContext();
    const filteredEvents = this.filterEvents(events);
    const embedded = options.embedded === true;

    let body;
    if (events.length === 0) {
      body = html`
        <div
          class="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center"
        >
          <div class="text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8">
            ${this.renderIcon("Zap")}
          </div>
          <span class="text-sm text-gray-600">No events yet</span>
          <span class="max-w-[240px] text-xs leading-snug text-gray-400"
            >Events are recorded live. Run the agent to see them here.</span
          >
        </div>
      `;
    } else if (filteredEvents.length === 0) {
      body = html`
        <div
          class="flex h-full items-center justify-center px-4 py-8 text-center"
        >
          <div class="max-w-md space-y-3">
            <div
              class="flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
            >
              ${this.renderIcon("Filter")}
            </div>
            <p class="text-sm text-gray-600">
              No events match the current filters.
            </p>
            <div>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-gray-800"
                @click=${this.resetEventFilters}
              >
                ${this.renderIcon("RefreshCw")}
                <span>Reset filters</span>
              </button>
            </div>
          </div>
        </div>
      `;
    } else {
      const runError = this.eventErrorDetails.run;
      const failedRunEventId = runError
        ? this.findLatestRunErrorEvent(runError.agentId)?.id
        : undefined;
      body = html`
        <div class="relative h-full w-full overflow-y-auto overflow-x-hidden">
          <table class="w-full table-fixed border-collapse text-xs box-border">
            <colgroup>
              <col style="width:${this.evtColWidths[0]}px" />
              <col style="width:${this.evtColWidths[1]}px" />
              <col style="width:${this.evtColWidths[2]}px" />
              <col />
            </colgroup>
            <thead class="sticky top-0 z-10">
              <tr class="bg-white">
                ${["Agent", "Time", "Event Type"].map(
                  (label, col) =>
                    html` <th
                      class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900"
                      style="position:relative;overflow:hidden;"
                    >
                      ${label}
                      <div
                        style="position:absolute;top:0;right:0;width:5px;height:100%;cursor:col-resize;user-select:none;background:transparent;"
                        @pointerdown=${(e: PointerEvent) =>
                          this._onEvtColResizeStart(e, col)}
                        @pointermove=${(e: PointerEvent) =>
                          this._onEvtColResizeMove(e)}
                        @pointerup=${() => this._onEvtColResizeEnd()}
                        @pointercancel=${() => this._onEvtColResizeEnd()}
                      ></div>
                    </th>`,
                )}
                <th
                  class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900"
                >
                  AG-UI Event
                </th>
              </tr>
            </thead>
            <tbody>
              ${filteredEvents.map((event, index) => {
                const isFailedRunEvent =
                  failedRunEventId !== undefined &&
                  event.id === failedRunEventId;
                const rowBg = isFailedRunEvent
                  ? "bg-rose-50"
                  : index % 2 === 0
                    ? "bg-white"
                    : "bg-gray-50/50";
                const badgeClasses = this.getEventBadgeClasses(event.type);
                const extractedEvent = this.extractEventFromPayload(
                  event.payload,
                );
                const inlineEvent =
                  this.stringifyPayload(extractedEvent, false) || "—";
                const prettyEvent =
                  this.stringifyPayload(extractedEvent, true) || inlineEvent;
                const isExpanded = this.expandedRows.has(event.id);

                return html`
                  <tr
                    class="${rowBg} cursor-pointer transition hover:bg-blue-50/50"
                    data-inspector-event-id=${event.id}
                    data-cpk-failed-run-event=${
                      isFailedRunEvent ? event.id : undefined
                    }
                    @click=${(clickEvent: Event) =>
                      this.toggleRowExpansion(event.id, clickEvent)}
                  >
                    <td
                      class="border-l border-r border-b border-gray-200 px-3 py-2"
                    >
                      <span class="font-mono text-[11px] text-gray-600"
                        >${event.agentId}</span
                      >
                    </td>
                    <td
                      class="border-r border-b border-gray-200 px-3 py-2 font-mono text-[11px] text-gray-600"
                    >
                      <span title=${new Date(event.timestamp).toLocaleString()}>
                        ${new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </td>
                    <td class="border-r border-b border-gray-200 px-3 py-2">
                      <span class=${badgeClasses}>${event.type}</span>
                    </td>
                    <td
                      class="border-r border-b border-gray-200 px-3 py-2 font-mono text-[10px] text-gray-600 ${
                        isExpanded ? "" : "truncate max-w-xs"
                      }"
                    >
                      ${
                        isExpanded
                          ? html`
                            <div class="group relative">
                              <pre
                                class="m-0 whitespace-pre-wrap break-words text-[10px] font-mono text-gray-600"
                              >
${prettyEvent}</pre
                              >
                              <button
                                class="absolute right-0 top-0 cursor-pointer rounded px-2 py-1 text-[10px] opacity-0 transition group-hover:opacity-100 ${
                                  this.copiedEvents.has(event.id)
                                    ? "bg-green-100 text-green-700"
                                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                                }"
                                @click=${(e: Event) => {
                                  e.stopPropagation();
                                  this.copyToClipboard(
                                    prettyEvent,
                                    event.id,
                                    e,
                                  );
                                }}
                              >
                                ${
                                  this.copiedEvents.has(event.id)
                                    ? html`
                                        <span>✓ Copied</span>
                                      `
                                    : html`
                                        <span>Copy</span>
                                      `
                                }
                              </button>
                            </div>
                          `
                          : inlineEvent
                      }
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `;
    }

    return html`
      <div
        class="${
          embedded
            ? "flex h-[28rem] min-h-[20rem] flex-col"
            : "flex h-full flex-col"
        }"
      >
        ${this.renderEventsToolbar(events, filteredEvents, {
          showAgentFilter: !embedded,
        })}
        <div class="min-h-0 flex-1 overflow-hidden">${body}</div>
      </div>
    `;
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
    this.eventFilterText = "";
    this.eventTypeFilter = "all";
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
    this.evtColWidths = this.evtColWidths.map((w, i) =>
      i === col ? Math.max(40, startW + (e.clientX - startX)) : w,
    );
    this.requestUpdate();
  }

  private _onEvtColResizeEnd(): void {
    this._evtColResize = null;
  }

  private handleClearEvents = (): void => {
    if (this.selectedContext === "all-agents") {
      this.agentEvents.clear();
      this.flattenedEvents = [];
    } else {
      this.agentEvents.delete(this.selectedContext);
      this.flattenedEvents = this.flattenedEvents.filter(
        (event) => event.agentId !== this.selectedContext,
      );
    }

    this.expandedRows.clear();
    this.copiedEvents.clear();
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

  private renderAgentsView() {
    // Show message if "all-agents" is selected or no agents available
    if (this.selectedContext === "all-agents") {
      return html`
        ${this.renderEventErrorBanner("tool")}
        <div
          class="flex h-full items-center justify-center px-4 py-8 text-center"
        >
          <div class="max-w-md">
            <div
              class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
            >
              ${this.renderIcon("Bot")}
            </div>
            <p class="text-sm text-gray-600">No agent selected</p>
            <p class="mt-2 text-xs text-gray-500">
              Select an agent from the dropdown above to view details.
            </p>
          </div>
        </div>
      `;
    }

    const agentId = this.selectedContext;
    const status = this.getAgentStatus(agentId);
    const stats = this.getAgentStats(agentId);
    const state = this.getLatestStateForAgent(agentId);
    const messages = this.getLatestMessagesForAgent(agentId);

    const statusColors = {
      running: "bg-emerald-50 text-emerald-700",
      idle: "bg-gray-100 text-gray-600",
      error: "bg-rose-50 text-rose-700",
    };

    return html`
      <div class="cpk-agent-view flex flex-col gap-4 p-4 overflow-auto">
        ${this.renderEventErrorBanner("tool")}
        <!-- Agent Overview Card -->
        <div
          class="cpk-agent-overview rounded-lg border border-gray-200 bg-white p-4"
        >
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center gap-3">
              <div
                class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 cpk-agent-icon"
              >
                ${this.renderIcon("Bot")}
              </div>
              <div>
                <h3 class="font-semibold text-sm text-gray-900">${agentId}</h3>
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    statusColors[status]
                  } relative -translate-y-[2px]"
                >
                  <span
                    class="h-1.5 w-1.5 rounded-full ${
                      status === "running"
                        ? "bg-emerald-500 animate-pulse"
                        : status === "error"
                          ? "bg-rose-500"
                          : "bg-gray-400"
                    }"
                  ></span>
                  ${status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
              </div>
            </div>
            ${
              stats.lastActivity
                ? html`<span class="text-xs text-gray-500"
                  >Last activity:
                  ${new Date(stats.lastActivity).toLocaleTimeString()}</span
                >`
                : nothing
            }
          </div>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
            <button
              type="button"
              class="rounded-md bg-gray-50 px-3 py-2 text-left transition hover:bg-gray-100 cursor-pointer overflow-hidden cpk-stat-card"
              @click=${() => this.handleMenuSelect("ag-ui-events")}
              title="View all events in AG-UI Events"
            >
              <div class="truncate whitespace-nowrap text-xs text-gray-600">
                Total Events
              </div>
              <div class="text-lg font-semibold text-gray-900">
                ${stats.totalEvents}
              </div>
            </button>
            <div
              class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden cpk-stat-card"
            >
              <div class="truncate whitespace-nowrap text-xs text-gray-600">
                Messages
              </div>
              <div class="text-lg font-semibold text-gray-900">
                ${stats.messages}
              </div>
            </div>
            <div
              class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden cpk-stat-card"
            >
              <div class="truncate whitespace-nowrap text-xs text-gray-600">
                Tool Calls
              </div>
              <div class="text-lg font-semibold text-gray-900">
                ${stats.toolCalls}
              </div>
            </div>
            <div
              class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden cpk-stat-card"
            >
              <div class="truncate whitespace-nowrap text-xs text-gray-600">
                Errors
              </div>
              <div class="text-lg font-semibold text-gray-900">
                ${stats.errors}
              </div>
            </div>
          </div>
        </div>

        <!-- Current State Section -->
        <div class="cpk-section-card">
          <div class="cpk-section-header">
            <h4>Current State</h4>
          </div>
          <div class="overflow-auto p-4">
            ${
              this.hasRenderableState(state)
                ? renderHighlightedJsonBlock(state, { maxHeight: "16rem" })
                : html`
                  <div
                    class="flex h-12 items-center justify-center text-xs text-gray-500"
                  >
                    <div class="flex items-center gap-2 text-gray-500">
                      <span class="text-lg text-gray-400"
                        >${this.renderIcon("Database")}</span
                      >
                      <span>State is empty</span>
                    </div>
                  </div>
                `
            }
          </div>
        </div>

        <!-- Current Messages Section -->
        <div class="cpk-section-card">
          <div class="cpk-section-header">
            <h4>Current Messages</h4>
          </div>
          <div class="overflow-auto">
            ${
              messages && messages.length > 0
                ? html`
                  <div class="w-full text-xs">
                    <div class="flex bg-gray-50">
                      <div
                        class="w-40 shrink-0 px-4 py-2 font-medium text-gray-700"
                      >
                        Role
                      </div>
                      <div class="flex-1 px-4 py-2 font-medium text-gray-700">
                        Content
                      </div>
                    </div>
                    <div class="divide-y divide-gray-200">
                      ${messages.map((msg) => {
                        const role = msg.role || "unknown";
                        const roleColors: Record<string, string> = {
                          user: "bg-blue-100 text-blue-800",
                          assistant: "bg-green-100 text-green-800",
                          system: "bg-gray-100 text-gray-800",
                          tool: "bg-amber-100 text-amber-800",
                          unknown: "bg-gray-100 text-gray-600",
                        };

                        const rawContent = msg.contentText ?? "";
                        const toolCalls = msg.toolCalls ?? [];
                        const hasContent = rawContent.trim().length > 0;
                        const contentFallback =
                          toolCalls.length > 0 ? "Invoked tool call" : "—";

                        const toolError = this.eventErrorDetails.tool;
                        const isFailedResult =
                          role === "tool" &&
                          toolError?.toolCallId !== undefined &&
                          toolError.toolCallId === msg.toolCallId;

                        return html`
                          <div
                            class=${
                              isFailedResult
                                ? "flex items-start bg-rose-50"
                                : "flex items-start"
                            }
                            data-cpk-failed-tool-result=${
                              isFailedResult ? msg.toolCallId : nothing
                            }
                          >
                            <div class="w-40 shrink-0 px-4 py-2">
                              <span
                                class="inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${
                                  roleColors[role] || roleColors.unknown
                                }"
                              >
                                ${role}
                              </span>
                            </div>
                            <div class="flex-1 px-4 py-2">
                              ${
                                hasContent
                                  ? html`<div
                                    class="whitespace-pre-wrap break-words text-gray-700"
                                  >${rawContent}</div>`
                                  : html`<div class="italic text-gray-400">
                                    ${contentFallback}
                                  </div>`
                              }
                              ${
                                role === "assistant" && toolCalls.length > 0
                                  ? this.renderToolCallDetails(toolCalls)
                                  : nothing
                              }
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                  </div>
                `
                : html`
                  <div
                    class="flex h-12 items-center justify-center text-xs text-gray-500"
                  >
                    <div class="flex items-center gap-2 text-gray-500">
                      <span class="text-lg text-gray-400"
                        >${this.renderIcon("MessageSquare")}</span
                      >
                      <span>No messages available</span>
                    </div>
                  </div>
                `
            }
          </div>
        </div>

        ${this.renderAgentToolsSection(agentId)}

        <div class="cpk-section-card overflow-hidden">
          <div class="cpk-section-header">
            <h4>AG-UI Events</h4>
          </div>
          ${this.renderEventsTable({ embedded: true })}
        </div>
      </div>
    `;
  }

  private renderContextDropdown(iconRail = false) {
    // Filter out "all-agents" when in agents view
    const filteredOptions =
      this.selectedMenu === "agents"
        ? this.contextOptions.filter((opt) => opt.key !== "all-agents")
        : this.contextOptions;

    const selectedLabel =
      filteredOptions.find((opt) => opt.key === this.selectedContext)?.label ??
      "";

    return html`
      <div
        class="relative z-40 min-w-0 flex-1"
        data-context-dropdown-root="true"
        @pointerenter=${
          iconRail ? this.handleIconRailContextPointerEnter : nothing
        }
        @pointerleave=${
          iconRail ? this.handleIconRailContextPointerLeave : nothing
        }
        @focusin=${iconRail ? this.handleIconRailContextFocusIn : nothing}
        @focusout=${iconRail ? this.handleIconRailContextFocusOut : nothing}
      >
        <button
          type="button"
          class="relative z-40 flex w-full min-w-0 max-w-[240px] items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
          aria-label="Select agent scope: ${selectedLabel}"
          title=${selectedLabel}
          @pointerdown=${
            iconRail
              ? this.handleIconRailContextPointerDown
              : this.handleContextDropdownToggle
          }
        >
          <span
            class="inspector-context-dropdown-icon shrink-0"
            aria-hidden="true"
            >${this.renderIcon("Bot")}</span
          >
          <span
            class="inspector-context-dropdown-label truncate flex-1 text-left"
            >${selectedLabel}</span
          >
          <span
            class="inspector-context-dropdown-chevron shrink-0 text-gray-400"
            >${this.renderIcon("ChevronDown")}</span
          >
        </button>
        ${
          this.contextMenuOpen
            ? html`
              <div
                class="absolute left-0 z-50 mt-1.5 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-md ring-1 ring-black/5"
                data-context-dropdown-root="true"
              >
                ${filteredOptions.map(
                  (option) => html`
                    <button
                      type="button"
                      class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                      data-context-dropdown-root="true"
                      @click=${() => this.handleContextOptionSelect(option.key)}
                    >
                      <span
                        class="truncate ${
                          option.key === this.selectedContext
                            ? "text-gray-900 font-medium"
                            : "text-gray-600"
                        }"
                        >${option.label}</span
                      >
                      ${
                        option.key === this.selectedContext
                          ? html`<span class="text-gray-500"
                            >${this.renderIcon("Check")}</span
                          >`
                          : nothing
                      }
                    </button>
                  `,
                )}
              </div>
            `
            : nothing
        }
      </div>
    `;
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

    if (key === "playground" && !this.playgroundAgent) {
      this.startPlaygroundSession(false);
    }

    if (key === "memories") {
      // Lazily create + subscribe to the memory store on first activation. This
      // is the only place that touches getMemoryStore(), so the store/realtime
      // are never started just by attaching the inspector.
      this.ensureMemorySubscription();
      if (previousMenu !== "memories" && !this.core?.telemetryDisabled) {
        trackMemoriesTabClicked(this.getMemoriesTelemetryProps());
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

  private handleContextDropdownToggle(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.layoutMenuOpen = false;
    this.contextMenuOpen = !this.contextMenuOpen;
    this.requestUpdate();
  }

  /** Expand the icon-rail agent scope on hover while preserving keyboard access. */
  private handleIconRailContextPointerEnter = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || this.contextMenuOpen) {
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
    this.contextMenuOpen = false;
    this.requestUpdate();
  };

  private handleIconRailContextPointerDown = (event: PointerEvent): void => {
    // A hover-only rail still needs to be operable on touch devices.
    if (event.pointerType === "touch") {
      this.handleContextDropdownToggle(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  private handleIconRailContextFocusIn = (): void => {
    if (this.contextMenuOpen) {
      return;
    }
    this.layoutMenuOpen = false;
    this.contextMenuOpen = true;
    this.requestUpdate();
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
  }

  private renderCapabilitiesView() {
    if (!this._core) {
      return html`
        <div
          class="flex h-full items-center justify-center px-4 py-8 text-xs text-gray-500"
        >
          No core instance available
        </div>
      `;
    }

    const toolRows = buildCapabilityRows(
      this._core as unknown as CapabilityToolSource,
    );
    const catalog = this._core.catalogComponents ?? [];
    const hasCatalog = catalog.length > 0;

    if (toolRows.length === 0 && !hasCatalog) {
      return html`
        <div
          class="flex h-full items-center justify-center px-4 py-8 text-center"
        >
          <div class="max-w-md">
            <div
              class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
            >
              ${this.renderIcon("SlidersHorizontal")}
            </div>
            <p class="text-sm text-gray-600">No capabilities registered</p>
            <p class="mt-2 text-xs text-gray-500">
              Frontend tools and A2UI catalog components will appear here once
              they are registered on the CopilotKit core.
            </p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="flex h-full flex-col overflow-hidden">
        <div class="overflow-auto p-4">
          <div class="space-y-3">
            <p class="text-xs text-gray-500">
              Toggle a capability off to omit it from what the agent sees. This
              is a client-side experimentation surface and takes effect
              immediately.
            </p>
          </div>

          ${
            toolRows.length > 0
              ? html`
                <div class="mt-4 space-y-2">
                  <h3 class="text-sm text-slate-500">Frontend tools</h3>
                  <div class="space-y-2">
                    ${toolRows.map((row) => this.renderCapabilityRow(row))}
                  </div>
                </div>
              `
              : nothing
          }
          ${
            hasCatalog
              ? html`
                <div class="mt-6 space-y-2">
                  <h3 class="text-sm text-slate-500">
                    A2UI catalog components
                  </h3>
                  <div class="space-y-2">
                    ${catalog.map((component) =>
                      this.renderCapabilityRow({
                        key: component.name,
                        name: component.name,
                        description: component.description,
                        enabled: this._core!.isCatalogComponentEnabled(
                          component.name,
                        ),
                      }),
                    )}
                  </div>
                </div>
              `
              : nothing
          }
        </div>
      </div>
    `;
  }

  private renderCapabilityRow(row: CapabilityToolRow) {
    // Frontend-tool keys are always `${agentId}:${name}` (agentId may be ""),
    // so they contain a ":"; catalog keys are the bare component name.
    const isTool = row.key.includes(":");
    return html`
      <div
        class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm font-semibold text-gray-900"
              >${row.name}</span
            >
            ${
              row.agentId
                ? html`<span
                  class="inline-flex items-center gap-1 text-xs text-gray-500"
                >
                  ${this.renderIcon("Bot")}<span class="font-mono"
                    >${row.agentId}</span
                  >
                </span>`
                : nothing
            }
          </div>
          ${
            row.description
              ? html`<p class="mt-1 text-xs text-gray-600">${row.description}</p>`
              : nothing
          }
        </div>
        ${this.renderCapabilitySwitch(row.enabled, () =>
          isTool
            ? this.handleToggleTool(row)
            : this.handleToggleCatalogComponent(row.name),
        )}
      </div>
    `;
  }

  private renderCapabilitySwitch(enabled: boolean, onToggle: () => void) {
    const track = enabled ? "bg-emerald-500" : "bg-gray-300";
    const knob = enabled ? "translate-x-4" : "translate-x-0.5";
    return html`
      <button
        type="button"
        role="switch"
        aria-checked=${enabled ? "true" : "false"}
        class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-300 ${track}"
        @click=${onToggle}
      >
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${knob}"
        ></span>
      </button>
    `;
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

  private renderToolsView() {
    if (!this._core) {
      return html`
        <div
          class="flex h-full items-center justify-center px-4 py-8 text-xs text-gray-500"
        >
          No core instance available
        </div>
      `;
    }

    this.refreshToolsSnapshot();
    const allTools = this.cachedTools;

    if (allTools.length === 0) {
      return html`
        <div
          class="flex h-full items-center justify-center px-4 py-8 text-center"
        >
          <div class="max-w-md">
            <div
              class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
            >
              ${this.renderIcon("Hammer")}
            </div>
            <p class="text-sm text-gray-600">No tools available</p>
            <p class="mt-2 text-xs text-gray-500">
              Tools will appear here once agents are configured with tool
              handlers or renderers.
            </p>
          </div>
        </div>
      `;
    }

    // Filter tools by selected agent
    const filteredTools =
      this.selectedContext === "all-agents"
        ? allTools
        : allTools.filter(
            (tool) => !tool.agentId || tool.agentId === this.selectedContext,
          );

    return html`
      <div class="flex h-full flex-col overflow-hidden">
        <div class="overflow-auto p-4">
          <div class="space-y-3">
            ${filteredTools.map((tool) => this.renderToolCard(tool))}
          </div>
        </div>
      </div>
    `;
  }

  private extractToolsFromAgents(): InspectorToolDefinition[] {
    if (!this._core) {
      return [];
    }

    const tools: InspectorToolDefinition[] = [];

    // Start with tools registered on the core (frontend tools / HIL)
    for (const coreTool of this._core.tools ?? []) {
      tools.push({
        agentId: coreTool.agentId ?? "",
        name: coreTool.name,
        description: coreTool.description,
        parameters: coreTool.parameters,
        type: "handler",
      });
    }

    // Augment with agent-level tool handlers/renderers
    for (const [agentId, agent] of Object.entries(this._core.agents)) {
      if (!agent) continue;

      // Try to extract tool handlers
      const handlers = (agent as { toolHandlers?: Record<string, unknown> })
        .toolHandlers;
      if (handlers && typeof handlers === "object") {
        for (const [toolName, handler] of Object.entries(handlers)) {
          if (handler && typeof handler === "object") {
            const handlerObj = handler as Record<string, unknown>;
            tools.push({
              agentId,
              name: toolName,
              description:
                (typeof handlerObj.description === "string" &&
                  handlerObj.description) ||
                (handlerObj.tool as { description?: string } | undefined)
                  ?.description,
              parameters:
                handlerObj.parameters ??
                (handlerObj.tool as { parameters?: unknown } | undefined)
                  ?.parameters,
              type: "handler",
            });
          }
        }
      }

      // Try to extract tool renderers
      const renderers = (agent as { toolRenderers?: Record<string, unknown> })
        .toolRenderers;
      if (renderers && typeof renderers === "object") {
        for (const [toolName, renderer] of Object.entries(renderers)) {
          // Don't duplicate if we already have it as a handler
          if (
            !tools.some((t) => t.agentId === agentId && t.name === toolName)
          ) {
            if (renderer && typeof renderer === "object") {
              const rendererObj = renderer as Record<string, unknown>;
              tools.push({
                agentId,
                name: toolName,
                description:
                  (typeof rendererObj.description === "string" &&
                    rendererObj.description) ||
                  (rendererObj.tool as { description?: string } | undefined)
                    ?.description,
                parameters:
                  rendererObj.parameters ??
                  (rendererObj.tool as { parameters?: unknown } | undefined)
                    ?.parameters,
                type: "renderer",
              });
            }
          }
        }
      }
    }

    return tools.sort((a, b) => {
      const agentCompare = a.agentId.localeCompare(b.agentId);
      if (agentCompare !== 0) return agentCompare;
      return a.name.localeCompare(b.name);
    });
  }

  private renderToolCard(tool: InspectorToolDefinition) {
    const isExpanded = this.expandedTools.has(`${tool.agentId}:${tool.name}`);
    const schema = this.extractSchemaInfo(tool.parameters);

    const typeColors = {
      handler: "bg-blue-50 text-blue-700 border-blue-200",
      renderer: "bg-purple-50 text-purple-700 border-purple-200",
    };

    return html`
      <div class="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          class="w-full px-4 py-3 text-left transition hover:bg-gray-50"
          @click=${() =>
            this.toggleToolExpansion(`${tool.agentId}:${tool.name}`)}
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-mono text-sm font-semibold text-gray-900"
                  >${tool.name}</span
                >
                <span
                  class="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${
                    typeColors[tool.type]
                  }"
                >
                  ${tool.type}
                </span>
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-500">
                <span class="flex items-center gap-1">
                  ${this.renderIcon("Bot")}
                  <span class="font-mono">${tool.agentId}</span>
                </span>
                ${
                  schema.properties.length > 0
                    ? html`
                      <span class="text-gray-300">•</span>
                      <span
                        >${schema.properties.length}
                        parameter${
                          schema.properties.length !== 1 ? "s" : ""
                        }</span
                      >
                    `
                    : nothing
                }
              </div>
              ${
                tool.description
                  ? html`<p class="mt-2 text-xs text-gray-600">
                    ${tool.description}
                  </p>`
                  : nothing
              }
            </div>
            <span
              class="shrink-0 text-gray-400 transition ${
                isExpanded ? "rotate-180" : ""
              }"
            >
              ${this.renderIcon("ChevronDown")}
            </span>
          </div>
        </button>

        ${
          isExpanded
            ? html`
              <div class="border-t border-gray-200 bg-gray-50/50 px-4 py-3">
                ${
                  schema.properties.length > 0
                    ? html`
                      <h5 class="mb-3 text-xs font-semibold text-gray-700">
                        Parameters
                      </h5>
                      <div class="space-y-3">
                        ${schema.properties.map(
                          (prop) => html`
                            <div
                              class="rounded-md border border-gray-200 bg-white p-3"
                            >
                              <div
                                class="flex items-start justify-between gap-2 mb-1"
                              >
                                <span
                                  class="font-mono text-xs font-medium text-gray-900"
                                  >${prop.name}</span
                                >
                                <div class="flex items-center gap-1.5 shrink-0">
                                  ${
                                    prop.required
                                      ? html`
                                          <span
                                            class="text-[9px] rounded border border-rose-200 bg-rose-50 px-1 py-0.5 font-medium text-rose-700"
                                            >required</span
                                          >
                                        `
                                      : html`
                                          <span
                                            class="text-[9px] rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-medium text-gray-600"
                                            >optional</span
                                          >
                                        `
                                  }
                                  ${
                                    prop.type
                                      ? html`<span
                                        class="text-[9px] rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-gray-600"
                                        >${prop.type}</span
                                      >`
                                      : nothing
                                  }
                                </div>
                              </div>
                              ${
                                prop.description
                                  ? html`<p class="mt-1 text-xs text-gray-600">
                                    ${prop.description}
                                  </p>`
                                  : nothing
                              }
                              ${
                                prop.defaultValue !== undefined
                                  ? html`
                                    <div
                                      class="mt-2 flex items-center gap-1.5 text-[10px] text-gray-500"
                                    >
                                      <span>Default:</span>
                                      <code
                                        class="rounded bg-gray-100 px-1 py-0.5 font-mono"
                                        >${JSON.stringify(
                                          prop.defaultValue,
                                        )}</code
                                      >
                                    </div>
                                  `
                                  : nothing
                              }
                              ${
                                prop.enum && prop.enum.length > 0
                                  ? html`
                                    <div class="mt-2">
                                      <span class="text-[10px] text-gray-500"
                                        >Allowed values:</span
                                      >
                                      <div class="mt-1 flex flex-wrap gap-1">
                                        ${prop.enum.map(
                                          (val) => html`
                                            <code
                                              class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono text-gray-700"
                                              >${JSON.stringify(val)}</code
                                            >
                                          `,
                                        )}
                                      </div>
                                    </div>
                                  `
                                  : nothing
                              }
                            </div>
                          `,
                        )}
                      </div>
                    `
                    : html`
                        <div class="flex items-center justify-center py-4 text-xs text-gray-500">
                          <span>No parameters defined</span>
                        </div>
                      `
                }
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  private extractSchemaInfo(parameters: unknown): {
    properties: Array<{
      name: string;
      type?: string;
      description?: string;
      required: boolean;
      defaultValue?: unknown;
      enum?: unknown[];
    }>;
  } {
    const result: {
      properties: Array<{
        name: string;
        type?: string;
        description?: string;
        required: boolean;
        defaultValue?: unknown;
        enum?: unknown[];
      }>;
    } = { properties: [] };

    if (!parameters || typeof parameters !== "object") {
      return result;
    }

    // Try Zod schema introspection
    const zodDef = (parameters as { _def?: Record<string, unknown> })._def;
    if (zodDef && typeof zodDef === "object") {
      // Handle Zod object schema
      if (zodDef.typeName === "ZodObject") {
        const rawShape = zodDef.shape;
        const shape =
          typeof rawShape === "function"
            ? (rawShape as () => Record<string, unknown>)()
            : (rawShape as Record<string, unknown> | undefined);

        if (!shape || typeof shape !== "object") {
          return result;
        }
        const requiredKeys = new Set<string>();

        // Get required fields
        if (zodDef.unknownKeys === "strict" || !zodDef.catchall) {
          Object.keys(shape || {}).forEach((key) => {
            const candidate = (shape as Record<string, unknown>)[key];
            const fieldDef = (
              candidate as { _def?: Record<string, unknown> } | undefined
            )?._def;
            if (fieldDef && !this.isZodOptional(candidate)) {
              requiredKeys.add(key);
            }
          });
        }

        // Extract properties
        for (const [key, value] of Object.entries(shape || {})) {
          const fieldInfo = this.extractZodFieldInfo(value);
          result.properties.push({
            name: key,
            type: fieldInfo.type,
            description: fieldInfo.description,
            required: requiredKeys.has(key),
            defaultValue: fieldInfo.defaultValue,
            enum: fieldInfo.enum,
          });
        }
      }
    } else if (
      (parameters as { type?: string; properties?: Record<string, unknown> })
        .type === "object" &&
      (parameters as { properties?: Record<string, unknown> }).properties
    ) {
      // Handle JSON Schema format
      const props = (parameters as { properties?: Record<string, unknown> })
        .properties;
      const required = new Set(
        Array.isArray((parameters as { required?: string[] }).required)
          ? (parameters as { required?: string[] }).required
          : [],
      );

      for (const [key, value] of Object.entries(props ?? {})) {
        const prop = value as Record<string, unknown>;
        result.properties.push({
          name: key,
          type: prop.type as string | undefined,
          description:
            typeof prop.description === "string" ? prop.description : undefined,
          required: required.has(key),
          defaultValue: prop.default,
          enum: Array.isArray(prop.enum) ? prop.enum : undefined,
        });
      }
    }

    return result;
  }

  private isZodOptional(zodSchema: unknown): boolean {
    const schema = zodSchema as { _def?: Record<string, unknown> };
    if (!schema?._def) return false;

    const def = schema._def;

    // Check if it's explicitly optional or nullable
    if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      return true;
    }

    // Check if it has a default value
    if (def.defaultValue !== undefined) {
      return true;
    }

    return false;
  }

  private extractZodFieldInfo(zodSchema: unknown): {
    type?: string;
    description?: string;
    defaultValue?: unknown;
    enum?: unknown[];
  } {
    const info: {
      type?: string;
      description?: string;
      defaultValue?: unknown;
      enum?: unknown[];
    } = {};

    const schema = zodSchema as { _def?: Record<string, unknown> };
    if (!schema?._def) return info;

    let currentSchema = schema as { _def?: Record<string, unknown> };
    let def = currentSchema._def as Record<string, unknown>;

    // Unwrap optional/nullable
    while (
      def.typeName === "ZodOptional" ||
      def.typeName === "ZodNullable" ||
      def.typeName === "ZodDefault"
    ) {
      if (def.typeName === "ZodDefault" && def.defaultValue !== undefined) {
        info.defaultValue =
          typeof def.defaultValue === "function"
            ? def.defaultValue()
            : def.defaultValue;
      }
      currentSchema =
        (def.innerType as { _def?: Record<string, unknown> }) ?? currentSchema;
      if (!currentSchema?._def) break;
      def = currentSchema._def as Record<string, unknown>;
    }

    // Extract description
    info.description =
      typeof def.description === "string" ? def.description : undefined;

    const typeName =
      typeof def.typeName === "string" ? def.typeName : undefined;

    // Extract type
    const typeMap: Record<string, string> = {
      ZodString: "string",
      ZodNumber: "number",
      ZodBoolean: "boolean",
      ZodArray: "array",
      ZodObject: "object",
      ZodEnum: "enum",
      ZodLiteral: "literal",
      ZodUnion: "union",
      ZodAny: "any",
      ZodUnknown: "unknown",
    };
    info.type = typeName
      ? typeMap[typeName] || typeName.replace("Zod", "").toLowerCase()
      : undefined;

    // Extract enum values
    if (typeName === "ZodEnum" && Array.isArray(def.values)) {
      info.enum = def.values as unknown[];
    } else if (typeName === "ZodLiteral" && def.value !== undefined) {
      info.enum = [def.value];
    }

    return info;
  }

  private toggleToolExpansion(toolId: string): void {
    if (this.expandedTools.has(toolId)) {
      this.expandedTools.delete(toolId);
    } else {
      this.expandedTools.add(toolId);
    }
    this.requestUpdate();
  }

  private renderContextView() {
    const contextEntries = Object.entries(this.contextStore);

    if (contextEntries.length === 0) {
      return html`
        <div
          class="flex h-full items-center justify-center px-4 py-8 text-center"
        >
          <div class="max-w-md">
            <div
              class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
            >
              ${this.renderIcon("FileText")}
            </div>
            <p class="text-sm text-gray-600">No context available</p>
            <p class="mt-2 text-xs text-gray-500">
              Context will appear here once added to CopilotKit.
            </p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="flex h-full flex-col overflow-hidden">
        <div class="overflow-auto p-4">
          <div class="space-y-3">
            ${contextEntries.map(([id, context]) =>
              this.renderContextCard(id, context),
            )}
          </div>
        </div>
      </div>
    `;
  }

  private renderContextCard(
    id: string,
    context: { description?: string; value: unknown },
  ) {
    const isExpanded = this.expandedContextItems.has(id);
    const valuePreview = this.getContextValuePreview(context.value);
    const hasValue = context.value !== undefined && context.value !== null;
    const title = context.description?.trim() || id;

    return html`
      <div class="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          class="w-full px-4 py-3 text-left transition hover:bg-gray-50"
          @click=${() => this.toggleContextExpansion(id)}
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 mb-1">${title}</p>
              <div class="flex items-center gap-2 text-xs text-gray-500">
                <span
                  class="font-mono truncate inline-block align-middle"
                  style="max-width: 180px;"
                  >${id}</span
                >
                ${
                  hasValue
                    ? html`
                      <span class="text-gray-300">•</span>
                      <span class="truncate">${valuePreview}</span>
                    `
                    : nothing
                }
              </div>
            </div>
            <span
              class="shrink-0 text-gray-400 transition ${
                isExpanded ? "rotate-180" : ""
              }"
            >
              ${this.renderIcon("ChevronDown")}
            </span>
          </div>
        </button>

        ${
          isExpanded
            ? html`
              <div class="border-t border-gray-200 bg-gray-50/50 px-4 py-3">
                <div class="mb-3">
                  <h5 class="mb-1 text-xs font-semibold text-gray-700">ID</h5>
                  <code
                    class="font-mono text-xs font-medium text-gray-800 flex-1 truncate min-w-0"
                    >${id}</code
                  >
                  <button
                    type="button"
                    class="cpk-copy-btn"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      void this.copyContextValue(id, `${id}:id`, e);
                    }}
                  >
                    ${this.copiedContextItems.has(`${id}:id`) ? "✓" : "Copy"}
                  </button>
                </div>
                ${
                  hasValue
                    ? html`
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <h5 class="text-xs font-semibold text-gray-700">
                          Value
                        </h5>
                        <button
                          type="button"
                          class="cpk-copy-btn"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            void this.copyContextValue(context.value, id, e);
                          }}
                        >
                          ${
                            this.copiedContextItems.has(id)
                              ? "Copied"
                              : "Copy JSON"
                          }
                        </button>
                      </div>
                      ${renderHighlightedJsonBlock(context.value, {
                        maxHeight: "180px",
                      })}
                    `
                    : html`
                        <div class="flex items-center justify-center py-4 text-xs text-gray-500">
                          <span>No value available</span>
                        </div>
                      `
                }
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  private getContextValuePreview(value: unknown): string {
    const parsed = coerceJsonValue(value);

    if (parsed === undefined || parsed === null) {
      return "—";
    }

    if (typeof parsed === "string") {
      return parsed.length > 50 ? `${parsed.slice(0, 50)}...` : parsed;
    }

    if (typeof parsed === "number" || typeof parsed === "boolean") {
      return String(parsed);
    }

    if (Array.isArray(parsed)) {
      return `Array(${parsed.length})`;
    }

    if (typeof parsed === "object") {
      const keys = Object.keys(parsed);
      return `Object with ${keys.length} key${keys.length !== 1 ? "s" : ""}`;
    }

    if (typeof parsed === "function") {
      return "Function";
    }

    return String(parsed);
  }

  private getToolsForAgent(agentId: string): InspectorToolDefinition[] {
    this.refreshToolsSnapshot();
    return this.cachedTools.filter(
      (tool) => !tool.agentId || tool.agentId === agentId,
    );
  }

  private renderAgentToolsSection(agentId: string) {
    const tools = this.getToolsForAgent(agentId);

    return html`
      <div class="cpk-section-card">
        <div class="cpk-section-header">
          <h4>Registered Tools</h4>
        </div>
        <div class="overflow-auto p-4">
          ${
            tools.length > 0
              ? html`<div class="space-y-3">
                ${tools.map((tool) => this.renderToolCard(tool))}
              </div>`
              : html`
                <div
                  class="flex h-12 items-center justify-center text-xs text-gray-500"
                >
                  <div class="flex items-center gap-2 text-gray-500">
                    <span class="text-lg text-gray-400"
                      >${this.renderIcon("Hammer")}</span
                    >
                    <span>No tools registered</span>
                  </div>
                </div>
              `
          }
        </div>
      </div>
    `;
  }

  private formatContextValue(value: unknown): string {
    if (value === undefined) {
      return "undefined";
    }

    if (value === null) {
      return "null";
    }

    if (typeof value === "function") {
      return value.toString();
    }

    const pretty = this.formatStateForDisplay(coerceJsonValue(value));
    return pretty.length > 0 ? pretty : String(value);
  }

  private async copyContextValue(
    value: unknown,
    contextId: string,
    event?: Event,
  ): Promise<void> {
    const clipboard = this.getClipboard(event);
    if (!clipboard?.writeText) {
      console.warn("Clipboard API is not available in this environment.");
      return;
    }

    const serialized = this.formatContextValue(value);
    try {
      await clipboard.writeText(serialized);
      this.copiedContextItems.add(contextId);
      this.requestUpdate();
      setTimeout(() => {
        this.copiedContextItems.delete(contextId);
        this.requestUpdate();
      }, 1500);
    } catch (error) {
      console.error("Failed to copy context value:", error);
    }
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
    if (this.announcementTimestamp) {
      saveAnnouncementReadTimestamp(this.announcementTimestamp);
    }
    this.retireSignal(NEWS_SIGNAL_ID);
    this.requestUpdate();
  }

  // ── The beat ────────────────────────────────────────────────────────────

  /**
   * Requests one beat for a signal, running it now or deferring it.
   *
   * There is a single pending slot and four reasons a beat cannot land. All
   * four are the same situation — "cannot land now, run later" — and treating
   * them alike is the point: three separate behaviours for one situation would
   * not survive a third signal.
   *
   * Reason 3 is not cosmetic. Starting a beat while one runs does not restart
   * the animation, because the attribute it binds to does not change value and
   * the pseudo-element selectors match on attribute *presence*; the running
   * beat would merely change colour mid-flight. A failure that arms during an
   * announcement beat must wait for that beat to end, or it would run only as
   * its final fraction.
   *
   * A failure's beat is followed by a pill, and the whole 3.4-second gesture
   * holds this one slot for its full duration. That is not a second scheduling
   * concept: reason 3 already says "another beat is running", and a gesture is
   * simply a longer beat.
   */
  private startSignalPulse(key: LauncherSignalKey): void {
    const deferred =
      // 1. The panel is open, so there is no visible launcher. Pop-out is the
      //    same case: the host page renders only a portal anchor.
      this.isOpen ||
      // 2. Nobody is looking.
      (typeof document !== "undefined" &&
        document.visibilityState !== "visible") ||
      // 3. Another beat — or the pill that follows it — is already running.
      (this.gestureSlotSignal !== null && this.gestureSlotSignal !== key) ||
      // 4. Another signal currently owns the dot.
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
    } else if (this.announcementTimestamp && key === NEWS_SIGNAL_ID) {
      saveAnnouncementPulsedTimestamp(this.announcementTimestamp);
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
      // Reason 3 has just cleared.
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
   * and spoken sentence that follow it. One slot, not two — see reason 3 in
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
    return this._threadsErrorByAgent.size > 0;
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
        // to one request per `THREAD_LIST_DEBOUNCE_MS`, so a failure followed
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
    const id = this.announcementTimestamp;
    if (!id || this.viewedNewsSignalIds.has(id)) return;
    this.viewedNewsSignalIds.add(id);
    this.pendingNewsSignalViewed = {
      banner_id: id,
      surface: "launcher",
      presentation:
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "reduced_motion"
          : "animated",
      cta_label: this.announcementCtaLabel ?? undefined,
    };
    this.flushPendingWhatsNewTelemetry();
  }

  // ── What's new ─────────────────────────────────────────────────────────
  //
  // Built as a self-contained unit — its own render method, its own state,
  // and no dependency on the shape of today's two-level navigation — so the
  // planned sidebar restructuring can relocate it rather than rewrite it.

  /** Which of the three What's new states the feed currently supports. */
  private getWhatsNewState(): "loading" | "empty" | "content" {
    if (this.announcementHtml) return "content";
    return this.announcementLoaded ? "empty" : "loading";
  }

  /**
   * Which announcement surface is on screen right now, or null when the
   * announcement isn't visible. What's new is the only surface: an impression
   * requires the panel open, that view selected, and content actually
   * rendered — a loading state is not an impression.
   */
  private getVisibleBannerSurface(): WhatsNewSurface | null {
    if (!this.isOpen || this.settingsOpen) return null;
    if (this.selectedMenu !== WHATS_NEW_MENU_KEY) return null;
    return this.announcementHtml ? "whats_new" : null;
  }

  /**
   * The single condition that retires the news signal: What's new has
   * rendered *with content*.
   *
   * Deliberately not on panel open — the common reason to open the Inspector
   * is AG-UI events, and clearing there would burn a whole announcement
   * silently and turn "viewed" into "opened the Inspector at some point".
   * Deliberately not behind an acknowledge button, which is a dismiss button
   * under another name. And a loading state does not count, because the feed
   * is asynchronous and a reader who arrived early has seen nothing.
   *
   * The launcher dot and the navigation marker both read the same signal, so
   * the two can never disagree about whether something has been read.
   */
  private maybeCompleteWhatsNewView(): void {
    if (!this.getVisibleBannerSurface()) return;
    this.maybeTrackWhatsNewViewed();
    this.clearNewsSignal();
  }

  /**
   * Records a `whats_new_viewed` impression for whichever surface is
   * currently visible, once per announcement per surface.
   */
  private maybeTrackWhatsNewViewed(): void {
    const id = this.announcementTimestamp;
    if (!id) return;
    const surface = this.getVisibleBannerSurface();
    if (!surface) return;
    const key = `${id}:${surface}`;
    if (this.viewedBannerSurfaces.has(key)) return;
    if (this.pendingBannerViewed.length >= MAX_PENDING_BANNER_VIEWED) return;
    this.viewedBannerSurfaces.add(key);
    this.pendingBannerViewed.push({
      banner_id: id,
      surface,
      cta_label: this.announcementCtaLabel ?? undefined,
    });
    this.flushPendingWhatsNewTelemetry();
  }

  // Releases held notification telemetry once /info has answered, or discards
  // it when the runtime reports telemetry disabled.
  private flushPendingWhatsNewTelemetry(): void {
    if (
      this.pendingBannerViewed.length === 0 &&
      !this.pendingNewsSignalViewed
    ) {
      return;
    }
    if (this.core?.telemetryDisabled) {
      this.pendingBannerViewed = [];
      this.pendingNewsSignalViewed = null;
      return;
    }
    if (
      this.runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      return;
    }
    const queued = this.pendingBannerViewed;
    this.pendingBannerViewed = [];
    for (const props of queued) trackWhatsNewViewed(props);
    if (this.pendingNewsSignalViewed) {
      const props = this.pendingNewsSignalViewed;
      this.pendingNewsSignalViewed = null;
      trackWhatsNewSignalViewed(props);
    }
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
    try {
      const response = await fetch(ANNOUNCEMENT_URL, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Failed to load announcement (${response.status})`);
      }

      const data = (await response.json()) as {
        timestamp?: unknown;
        previewText?: unknown;
        announcement?: unknown;
        cta_label?: unknown;
      };

      const timestamp =
        typeof data?.timestamp === "string" ? data.timestamp : null;
      const previewText =
        typeof data?.previewText === "string" ? data.previewText : null;
      const markdown =
        typeof data?.announcement === "string" ? data.announcement : null;
      const ctaLabel =
        typeof data?.cta_label === "string" ? data.cta_label : null;

      if (!timestamp || !markdown) {
        throw new Error("Malformed announcement payload");
      }

      this.announcementTimestamp = timestamp;
      this.announcementPreviewText = previewText ?? "";
      this.announcementMarkdown = markdown;
      this.announcementCtaLabel = ctaLabel;
      this.announcementHtml = await this.convertMarkdownToHtml(markdown);
      this.announcementLoaded = true;

      // The signal arms on a timestamp plus a body that actually renders —
      // anything else would produce a dot that What's new can never clear,
      // because clearing requires content. `previewText` does NOT gate it:
      // that was defensible while the text was the bubble's headline, but it
      // is now just the heading, and gating on it would mean an announcement
      // without preview text produced no dot at all.
      if (
        this.announcementHtml &&
        loadAnnouncementReadTimestamp() !== timestamp
      ) {
        this.armNewsSignal({
          pulse: loadAnnouncementPulsedTimestamp() !== timestamp,
        });
      }

      this.requestUpdate();
    } catch (error) {
      // Swallowing here would hide non-network failures (malformed JSON, the
      // explicit "Malformed announcement payload" throw above, exceptions
      // from `convertMarkdownToHtml`). At minimum, surface in the console so
      // a stale announcement is debuggable.
      console.warn("[CopilotKit Inspector] Failed to load announcement", error);
      this.announcementLoaded = true;
      this.requestUpdate();
    }
  }

  private async convertMarkdownToHtml(
    markdown: string,
  ): Promise<string | null> {
    const renderer = new marked.Renderer();
    renderer.link = (href, title, text) => {
      const safeHref = this.escapeHtmlAttr(
        this.isSafeAnnouncementHref(href ?? "")
          ? this.appendRefParam(href ?? "")
          : "#",
      );
      const titleAttr = title ? ` title="${this.escapeHtmlAttr(title)}"` : "";
      return `<a href="${safeHref}" target="_blank" rel="noopener"${titleAttr}>${text}</a>`;
    };
    renderer.html = (html) => escapeHtml(html);
    renderer.code = (code, lang) => {
      const safeLang = (lang ?? "").replace(/[^a-z0-9-]/gi, "");
      const langClass = safeLang ? ` class="language-${safeLang}"` : "";
      const escaped = escapeHtml(code);
      const encoded = this.encodeBase64(code);
      return `<div class="announcement-code"><pre><code${langClass}>${escaped}</code></pre><div class="announcement-code__copy-shield"><button type="button" class="announcement-code__copy" data-copy="${encoded}" aria-label="Copy code">Copy</button></div></div>`;
    };
    return marked.parse(markdown, { renderer, async: false });
  }

  private isSafeAnnouncementHref(href: string): boolean {
    try {
      const url = new URL(
        href,
        typeof window !== "undefined"
          ? window.location.href
          : "https://copilotkit.ai",
      );
      return (
        url.protocol === "http:" ||
        url.protocol === "https:" ||
        url.protocol === "mailto:"
      );
    } catch {
      return false;
    }
  }

  private copyResetTimeouts = new WeakMap<HTMLButtonElement, number>();

  private encodeBase64(value: string): string {
    if (typeof window === "undefined" || typeof window.btoa !== "function") {
      return "";
    }
    // btoa only accepts Latin-1; round-trip via TextEncoder to keep full UTF-8.
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return window.btoa(binary);
  }

  private decodeBase64(value: string): string {
    if (typeof window === "undefined" || typeof window.atob !== "function") {
      return "";
    }
    const decoded = window.atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  private handleAnnouncementContentClick = (event: Event): void => {
    const target = event.target as {
      closest?: (selector: string) => Element | null;
    } | null;
    const copyControl =
      typeof target?.closest === "function"
        ? target.closest(".announcement-code__copy")
        : null;
    const button =
      copyControl?.tagName === "BUTTON"
        ? (copyControl as HTMLButtonElement)
        : null;
    if (!button) {
      const link =
        typeof target?.closest === "function" ? target.closest("a") : null;
      if (!link) return;

      const href = link.getAttribute("href");
      if (href) link.setAttribute("href", this.appendRefParam(href));

      // whats_new_clicked fires once per banner per mount. Dedup prevents
      // accidental multi-clicks from inflating the link-follow funnel.
      this.trackWhatsNewClickedOnce({ cta: "body" });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const encoded = button.getAttribute("data-copy") ?? "";
    const code = this.decodeBase64(encoded);
    if (!code) {
      return;
    }
    const showCopied = () => {
      const view = button.ownerDocument.defaultView ?? window;
      const existing = this.copyResetTimeouts.get(button);
      if (existing !== undefined) {
        view.clearTimeout(existing);
      }
      button.setAttribute("data-copied", "true");
      button.setAttribute("aria-label", "Code copied");
      button.textContent = "Copied";
      const id = view.setTimeout(() => {
        button.removeAttribute("data-copied");
        button.setAttribute("aria-label", "Copy code");
        button.textContent = "Copy";
        this.copyResetTimeouts.delete(button);
      }, 1500);
      this.copyResetTimeouts.set(button, id);
    };
    const clipboard = this.getClipboard(event);
    if (clipboard?.writeText) {
      clipboard.writeText(code).then(showCopied, () => {
        // ignore — clipboard may be unavailable (insecure context, denied
        // permission, focus loss); button silently stays in idle state.
      });
    }
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

  private escapeHtmlAttr(value: string): string {
    return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}

// `customElements` is missing during SSR and in torn-down DOM test
// environments. Resolve it when this function is called so registration can
// be retried once a browser registry becomes available.
export function defineWebInspector(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (!registry) return;

  defineElementOnce(registry, "cpk-thread-list", CpkThreadList);
  defineElementOnce(registry, THREAD_INSPECTOR_TAG, CpkThreadInspector);
  defineElementOnce(registry, "cpk-thread-details", ɵCpkThreadDetails);
  defineElementOnce(registry, "cpk-memory-list", CpkMemoryList);
  defineElementOnce(registry, WEB_INSPECTOR_TAG, WebInspectorElement);
}

defineWebInspector();

declare global {
  interface HTMLElementTagNameMap {
    "cpk-web-inspector": WebInspectorElement;
  }
}
