import { LitElement, html, nothing, unsafeCSS } from "lit";
import type { TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import tailwindStyles from "../styles/generated.css";
import inspectorLogoUrl from "../assets/inspector-logo.svg";
import inspectorLogoKiteUrl from "../assets/inspector-logo-kite.svg";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { icons } from "lucide";
import type { CopilotKitCore, CopilotKitCoreErrorCode } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type {
  CopilotKitCoreSubscriber,
  ɵThreadStore,
  ɵThread,
} from "@copilotkit/core";
import type { AbstractAgent, Message } from "@ag-ui/client";
import type {
  ContextKey,
  DockMode,
  InspectorColorScheme,
  InspectorOpenOptions,
} from "./contracts.js";
import {
  coreSupportsInspectorMetadata,
  getCoreStatusSummary as buildCoreStatusSummary,
  readCoreInspectorMetadata,
  readRuntimeLicense,
} from "./core-bridge.js";
import type { CoreStatusSummary } from "./core-bridge.js";
import {
  getSystemColorScheme,
  resolveColorSchemePreference,
} from "./settings/theme.js";
import { renderSettingsPanel as renderShellSettingsPanel } from "./settings/view.js";
import { buildPersistedShellState, INSPECTOR_STORAGE_KEY } from "./state.js";
import { LAUNCHER_MAX_SIZE, LAUNCHER_MIN_SIZE, shellStyles } from "./styles.js";
import { LauncherController } from "./launcher/controller.js";
import {
  EVENT_ERROR_GUIDANCE,
  LAUNCHER_SIGNALS,
  NEWS_SIGNAL_ID,
  isErrorSignalKey,
  isEventErrorKey,
} from "./launcher/model.js";
import type { LauncherSignalKey } from "./launcher/model.js";
import type { InspectorEventErrorDetails } from "./launcher/state.js";
import { renderLauncherView } from "./launcher/view.js";
import {
  loadInspectorState,
  saveInspectorState,
} from "../shared/persistence/inspector-state.js";
import type { PersistedState } from "../shared/persistence/inspector-state.js";
import { WindowController } from "./window/controller.js";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  getDockedWindowStyles,
  renderDockResizeHandle,
  renderFloatingResizeHandles,
  renderWindowLayoutMenu,
} from "./window/view.js";
import type {
  InspectorMetadataAction,
  InspectorMetadataProjection,
} from "../domains/home/model.js";
import {
  buildHomeModel,
  projectInspectorMetadata,
  runtimeConnectionNeedsAttention,
} from "../domains/home/model.js";
import type { HomeHeroAction, HomeModel } from "../domains/home/model.js";
import type { HomeServiceId, HomeServiceTile } from "../domains/home/model.js";
import {
  copyHomeFeaturePrompt,
  createHomeFeatureSetupState,
  disposeHomeFeatureSetupState,
  homeFeaturePromptCopyState,
} from "../domains/home/feature-setup.js";
import {
  copyIntelligenceOnboardingPrompt,
  createHomeIntelligenceState,
  disposeHomeIntelligenceState,
  pinIntelligenceStoryBeat,
  syncIntelligenceStory,
} from "../domains/home/intelligence-state.js";
import {
  renderFeatureSetupPromptButton,
  renderHomeView as renderHomeDomainView,
} from "../domains/home/view.js";
import { homeViewStyles } from "../domains/home/view.styles.js";
import {
  trackHomeAction,
  trackHomeFeaturePrompt,
  trackHomePromptCopy,
  trackHomeStorySelection,
  trackHomeView,
} from "../domains/home/telemetry.js";
import {
  clearLegacyAnnouncementReadState,
  loadAnnouncementFeed,
} from "../domains/announcements/feed.js";
import type { AnnouncementReady } from "../domains/announcements/feed.js";
import {
  announcementLinkFromClick,
  renderAnnouncementPreview,
  renderAnnouncementsView,
  synchronizeAnnouncementCopyControls,
} from "../domains/announcements/view.js";
import { announcementViewStyles } from "../domains/announcements/view.styles.js";
import { AnnouncementTelemetry } from "../domains/announcements/telemetry.js";
import {
  INSPECTOR_GROUPS,
  INSPECTOR_NAV_SECTIONS,
  getGroupForMenu,
  isInspectorMenuKey,
  shouldUseIconRail,
} from "./navigation/model.js";
import type { InspectorNavGroupKey, MenuKey } from "./navigation/model.js";
import {
  TELEMETRY_DOCS_URL,
  ensureTelemetryDistinctId,
  getRuntimeUrlType,
  getTelemetryDistinctIdForUrl,
  maybeShowDisclosure,
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
  trackThreadsTryFromHereClicked,
} from "../shared/telemetry/privacy.js";
import {
  createOnboardingRunId,
} from "../domains/home/onboarding-prompt.js";
import type { DisplayValue } from "../shared/display/types.js";
import type {
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
} from "../shared/thread-debugger/types.js";
import { runLearningRecall } from "../domains/learning/recall.js";
import {
  clearRecall as clearLearningRecall,
  createLearningState,
  resetLearningState,
  setRecallQuery,
} from "../domains/learning/state.js";
import { ensureLearningSubscription } from "../domains/learning/subscription.js";
import { trackLearningTabClicked } from "../domains/learning/telemetry.js";
import {
  LEARNING_VIEW_LABEL,
  renderLearningView,
} from "../domains/learning/view.js";
import { learningViewStyles } from "../domains/learning/view.styles.js";
import {
  retryPlaygroundRun,
  sendPlaygroundMessage,
  submitPlaygroundOnEnter,
  updatePlaygroundInput,
} from "../domains/playground/composer.js";
import { isPlaygroundSelectElement } from "../domains/playground/element-guards.js";
import {
  clearPlaygroundSession,
  createPlaygroundSession,
  createPlaygroundSubscriber,
  loadPlaygroundThread,
  loadPlaygroundThreadSnapshot,
  resolvePlaygroundAgentId,
  runPlaygroundAgent,
  syncPlaygroundMessages,
} from "../domains/playground/session.js";
import { createPlaygroundState } from "../domains/playground/state.js";
import {
  AGENT_SCOPE_POPUP_ID,
  AGENT_SCOPE_TRIGGER_ID,
  createLiveInspectionState,
} from "../domains/live-inspection/state.js";
import type {
  InspectorAgentEventType,
  InspectorEvent,
  InspectorMessage,
  InspectorToolCall,
  InspectorToolDefinition,
} from "../domains/live-inspection/state.js";
import {
  normalizeAgentMessages,
  subscribeToAgent as subscribeLiveAgent,
  teardownAgentSubscriptions as teardownLiveAgentSubscriptions,
  unsubscribeFromAgent as unsubscribeLiveAgent,
} from "../domains/live-inspection/agent-adapter.js";
import { recordEvent as recordLiveEvent } from "../domains/live-inspection/event-buffer.js";
import {
  EMPTY_INSPECTOR_MESSAGES,
  agentStats,
  agentStatus,
  hasRenderableState,
  latestMessagesForAgent,
  latestStateForAgent,
  liveAgentMessagesForThread,
} from "../domains/live-inspection/agents/model.js";
import {
  renderAgentScopeDropdown,
  renderAgentsView as renderLiveAgentsView,
} from "../domains/live-inspection/agents/view.js";
import { buildCapabilityRows } from "../domains/live-inspection/capabilities/model.js";
import type { CapabilityToolRow } from "../domains/live-inspection/capabilities/model.js";
import { renderCapabilitiesView as renderLiveCapabilitiesView } from "../domains/live-inspection/capabilities/view.js";
import { normalizeContextStore } from "../domains/live-inspection/context/model.js";
import { renderContextView as renderLiveContextView } from "../domains/live-inspection/context/view.js";
import {
  clearEvents,
  eventsForSelectedContext,
  resetEventFilters,
  resizeEventColumn,
} from "../domains/live-inspection/events/model.js";
import { renderEventsView } from "../domains/live-inspection/events/view.js";
import { liveInspectionViewStyles } from "../domains/live-inspection/events/view.styles.js";
import {
  refreshToolsSnapshot as refreshLiveToolsSnapshot,
  toolsForAgent,
} from "../domains/live-inspection/tools/model.js";
import {
  renderAgentToolsSection as renderLiveAgentToolsSection,
  renderToolsView as renderLiveToolsView,
} from "../domains/live-inspection/tools/view.js";
import { renderPlaygroundView as renderPlaygroundDomainView } from "../domains/playground/view.js";
import { playgroundViewStyles } from "../domains/playground/view.styles.js";
import type {
  ThreadDetailsTab,
  ɵCpkThreadDetails,
} from "../domains/threads/detail/thread-inspector.js";
import {
  areThreadEndpointsAvailable,
  getThreadServiceStatus,
  hasVisibleSettledRealThreads,
  selectActiveThreadsState,
  selectRealThread,
  selectVisibleRealThreadId,
  shouldRenderExampleThreads,
} from "../domains/threads/selectors.js";
import { createThreadsState } from "../domains/threads/state.js";
import {
  getExampleKind,
  THREADS_EXAMPLE_THREADS,
} from "../domains/threads/examples/data.js";
import {
  getExampleThreadProvider,
  isExampleThreadId,
} from "../domains/threads/examples/provider.js";
import {
  clearThreadsUsageRefresh,
  getMetadataActionPlacement,
  getThreadsCapacityState,
  getThreadsExpiryBucket,
  getThreadsUsageBucket,
  renderThreadsUsageFooter as renderThreadsDomainUsageFooter,
  scheduleThreadsUsageRefresh,
} from "../domains/threads/usage.js";
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
} from "../domains/threads/store-bridge.js";
import {
  dismissExampleTour as dismissTour,
  getExampleTourTelemetryPair,
  readExampleTourDismissed,
  setExampleTourStep as updateExampleTourStep,
  startExampleTour as activateExampleTour,
  THREADS_EXAMPLE_TOUR_STEPS,
  writeExampleTourDismissed,
} from "../domains/threads/examples/tour.js";
import {
  claimExampleSelected,
  claimExampleTourStep,
  claimExampleViewed,
  claimThreadsViewState,
} from "../domains/threads/telemetry/events.js";
import {
  getThreadsEmptyOnboardingAction,
  renderThreadsOverview,
  renderThreadsTour,
  renderThreadsView as renderThreadsDomainView,
  selectThread,
  SELF_HOSTED_INTELLIGENCE_URL,
  THREADS_DOCS_URL,
} from "../domains/threads/view.js";
import {
  cleanupThreadsExampleVideo,
  controlThreadsExampleVideo,
  reconcileThreadsExampleVideo,
  renderThreadsExampleVideo,
} from "../domains/threads/examples/video.js";
import { threadsViewStyles } from "../domains/threads/view.styles.js";
import type {
  ExampleKind,
  ExampleTourStep,
  ExampleTourTab,
  InspectorGroupKey,
  InspectorMetadataLicenseBucket,
  InspectorMetadataModuleViewedTelemetryProps,
  InspectorMetadataTelemetryModule,
  InspectorEventErrorSource,
  InspectorWiringErrorSource,
  InspectorOpenSource,
  InspectorThreadTelemetryProps,
  ThreadsExpiryBucket,
  ThreadsUsageBucket,
} from "../shared/telemetry/privacy.js";

export type { InspectorOpenOptions } from "./contracts.js";

/**
 * User-facing label for the What's new view. Its menu key stays `whats-new`
 * for persistence and telemetry stability, following the `memories`/"Memory"
 * precedent above.
 */
const WHATS_NEW_VIEW_LABEL = "What's new";

/** Menu key of the What's new leaf — the news signal's destination. */
const WHATS_NEW_MENU_KEY = NEWS_SIGNAL_ID;

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

/**
 * Coalesce inspector-owned GET /threads sends. The first refresh goes out
 * at once. Further calls in this window share one trailing request, so a
 * flaky network does not fire a burst of list fetches and error cards.
 */

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
  private readonly windowShell: WindowController = new WindowController({
    element: this,
    renderHost: this,
    getRenderRoot: () => this.renderRoot,
    getOwnerDocument: () => this.ownerDocument ?? document,
    getUpdateComplete: () => this.updateComplete,
    getStyles: () => WebInspectorElement.styles,
    renderWindow: () => this.renderWindow(),
    requestUpdate: () => this.requestUpdate(),
    persistState: () => this.persistState(),
    openInspector: () => this.openInspector("floating_button"),
    onLauncherReadyAfterClose: () => this.launcher.flushPendingSignalPulse(),
    closeContextMenu: () => {
      this.contextMenuOpen = false;
    },
    onGlobalPointerDown: (event) => this.handleGlobalPointerDown(event),
    isConnected: () => this.isConnected,
  });
  private accountCtaMotionPaused = false;
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
  private readonly homeIntelligence = createHomeIntelligenceState();
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
  private announcementLoadGeneration = 0;
  private hasCompletedFirstUpdate = false;
  private readonly announcementTelemetry = new AnnouncementTelemetry();
  private readonly launcher = new LauncherController({
    requestUpdate: () => this.requestUpdate(),
    isOpen: () => this.isOpen,
    isConnected: () => this.isConnected,
    activeRoot: () => this.activeRoot,
    announcement: () => this.announcement,
    telemetryDisabled: () => this.core?.telemetryDisabled ?? false,
    isWiringErrorBroken: (source, currentlyArmed) =>
      this.isErrorSourceBroken(source, currentlyArmed),
    isEventErrorLandingVisible: (key) =>
      this.isOpen &&
      !this.settingsOpen &&
      this.selectedMenu === LAUNCHER_SIGNALS[key].landingTarget,
    applyEventErrorLanding: (key) => this.applyEventErrorLanding(key),
    openInspector: () => this.openInspector("floating_button"),
    recordNewsPulse: (announcement, presentation) => {
      this.announcementTelemetry.recordLauncherPulse(
        announcement,
        presentation,
      );
      this.flushAnnouncementTelemetry();
    },
  });
  private get newsSignalArmed(): boolean {
    return this.launcher.state.newsSignalArmed;
  }
  private get eventErrorDetails() {
    return this.launcher.state.eventErrorDetails;
  }
  private pendingScrollToEventId: string | null = null;
  private pendingScrollToToolCallId: string | null = null;

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

  private get contextState() {
    return this.windowShell.contextState;
  }

  private get hasCustomPosition() {
    return this.windowShell.hasCustomPosition;
  }

  private get isOpen(): boolean {
    return this.windowShell.isOpen;
  }

  private set isOpen(value: boolean) {
    this.windowShell.isOpen = value;
  }

  private get dockMode(): DockMode {
    return this.windowShell.dockMode;
  }

  private get layoutMenuOpen(): boolean {
    return this.windowShell.layoutMenuOpen;
  }

  private set layoutMenuOpen(value: boolean) {
    this.windowShell.layoutMenuOpen = value;
  }

  private get isDragging(): boolean {
    return this.windowShell.isDragging;
  }

  private get pointerContext(): ContextKey | null {
    return this.windowShell.pointerContext;
  }

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

  private updateInspectorMetadataProjection(value: unknown): void {
    this.inspectorMetadataValue = value;
    this.inspectorMetadataProjection = projectInspectorMetadata(
      value,
      readRuntimeLicense(this._core),
    );
  }

  private attachToCore(core: CopilotKitCore): void {
    this.runtimeStatus = core.runtimeConnectionStatus;
    this.coreProperties = core.properties;
    this.lastCoreError = null;
    this.launcher.clearAllEventErrors();
    const supportsInspectorMetadata = coreSupportsInspectorMetadata(core);
    this.updateInspectorMetadataProjection(readCoreInspectorMetadata(core));

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
        this.launcher.armEventErrorFromCode(code, error.message, context);
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
      projectError: (error) =>
        this.launcher.armEventError("memory", error.message),
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
    this.launcher.clearAllEventErrors();
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

  private getClipboard(event?: Event): Clipboard | undefined {
    return this.windowShell.getClipboard(event);
  }

  static styles = [
    unsafeCSS(tailwindStyles),
    homeViewStyles,
    announcementViewStyles,
    learningViewStyles,
    playgroundViewStyles,
    threadsViewStyles,
    shellStyles,
    liveInspectionViewStyles,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof window !== "undefined") {
      this.accountCtaMotionPaused = document.visibilityState !== "visible";
      this.threads.exampleOverviewVideoReducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false;
      this.windowShell.ensureBrandFonts();
      window.addEventListener("resize", this.windowShell.handleResize);
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
      if (
        this.hasCompletedFirstUpdate &&
        this.isOpen &&
        this.dockMode !== "floating"
      ) {
        this.windowShell.applyInitialPlacement();
      }
      this.subscribeToSystemColorScheme();
      this.threads.exampleTourDismissed =
        this.readThreadsExampleTourDismissed();
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

  private handleDocumentVisibilityChange = (): void => {
    this.accountCtaMotionPaused = document.visibilityState !== "visible";
    // Flush point for defer reason 2: somebody is looking again.
    if (document.visibilityState === "visible" && !this.isOpen) {
      this.launcher.flushPendingSignalPulse();
    }
    this.requestUpdate();
  };

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.windowShell.closePopOut();
    if (typeof window !== "undefined") {
      this.unsubscribeFromSystemColorScheme();
      window.removeEventListener("resize", this.windowShell.handleResize);
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
    this.windowShell.clearTransitionTimers();
    this.clearIconRailContextCloseTimer();
    this.unsubscribeFromInspectorThreadBridge();
    disposeHomeFeatureSetupState(this.homeFeatureSetup);
    disposeHomeIntelligenceState(this.homeIntelligence);
    this.threads.setupPromptCopyGeneration += 1;
    if (this.threads.setupPromptCopyResetTimeoutId !== null) {
      window.clearTimeout(this.threads.setupPromptCopyResetTimeoutId);
      this.threads.setupPromptCopyResetTimeoutId = null;
    }
    this.threads.setupPromptCopyState = "idle";
    this.launcher.dispose();
    if (!this.announcementLoaded) {
      this.announcementLoadGeneration += 1;
      this.announcementPromise = null;
    }
    this.cancelThreadRefreshDebounce();
    this.clearInspectorUsageRefresh();
    this.cleanupThreadsExampleOverviewVideo();
    this.windowShell.removeDockStyles(true);
    this.detachFromCore();
  }

  firstUpdated(): void {
    this.hasCompletedFirstUpdate = true;
    if (typeof window === "undefined") {
      return;
    }

    if (!this._core) {
      this.tryAutoAttachCore();
    }

    this.windowShell.measureInitialContexts();
    this.hydrateStateFromStorage();
    this.windowShell.clampInitialWindowSize();

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

    this.windowShell.applyInitialPlacement();

    this.ensureAnnouncementLoading();

    this.windowShell.updateInitialHostTransform();
    this.launcher.scheduleHudIntro();
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
    this.launcher.evaluateErrorSignals();
    this.reconcileSelectedMenuVisibility();
    this.windowShell.syncDockAttribute();
  }

  protected updated(): void {
    this.windowShell.syncPortal();
    synchronizeAnnouncementCopyControls(this.activeRoot, this.getClipboard());
    this.syncThreadsExampleOverviewVideo();
    this.maybeTrackInspectorMetadataViews();
    this.launcher.maybeTrackNewsSignalViewed();
    // The pill's full width is only measurable once it has been laid out, and
    // the answer decides both the direction and the telemetry label below, so
    // this runs before the visibility event rather than after it.
    this.launcher.resolvePillDirection();
    this.launcher.maybeTrackErrorSignalViewed();
    // "Rendered with content" is a property of the finished render, so the
    // news signal is retired here rather than from a render method.
    this.maybeCompleteWhatsNewView();
    this.launcher.maybeCompleteEventErrorView();
    this.flushErrorLandingScroll();
    this.maybeTrackHomeViewed();
    this.syncHomeIntelligenceStory();

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

  private renderButton(): TemplateResult {
    return renderLauncherView({
      controller: this.launcher,
      colorScheme: this.colorScheme,
      anchorVertical: this.contextState.button.anchor.vertical,
      isDragging: this.isDragging,
      pointerContextIsButton: this.pointerContext === "button",
      getHudAvailability: () => {
        const homeModel = this.getHomeModel();
        return {
          threads: homeModel.services.some(
            (service) => service.id === "threads" && service.enabled,
          ),
          learning: homeModel.services.some(
            (service) => service.id === "memory" && service.enabled,
          ),
        };
      },
      renderIcon: (name) => this.renderIcon(name),
      onPointerDown: this.windowShell.handlePointerDown,
      onPointerMove: this.windowShell.handlePointerMove,
      onPointerUp: this.windowShell.handlePointerUp,
      onPointerCancel: this.windowShell.handlePointerCancel,
      onClick: this.windowShell.handleButtonClick,
    });
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
                  const marker = this.launcher.getNavigationSignalFor(item.key);
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
        copyPrompt: (event) => {
          void this.handleIntelligencePromptCopy(event);
        },
        openHeroAction: (action) => this.handleHomeHeroCta(action),
        openLastEvent: (eventId, agentId) =>
          this.handleHomeLastEventSelect(eventId, agentId),
        pinStoryBeat: (index) => this.handleIntelligenceStoryBeatSelect(index),
      },
      {
        announcementPreview,
        appendRefParam: (href, ref) => this.appendRefParam(href, ref),
        featurePromptCopyState: (serviceId) =>
          homeFeaturePromptCopyState(this.homeFeatureSetup, serviceId),
        intelligenceLogoUrl: inspectorLogoKiteUrl,
        renderIcon: (name) => this.renderIcon(name),
        state: this.homeIntelligence,
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

  private async handleIntelligencePromptCopy(event: Event): Promise<void> {
    await copyIntelligenceOnboardingPrompt(this.homeIntelligence, {
      clipboard: this.getClipboard(event),
      isConnected: () => this.isConnected,
      requestUpdate: () => this.requestUpdate(),
      trackOutcome: (runId, outcome) =>
        trackHomePromptCopy(
          runId,
          outcome,
          this.core?.telemetryDisabled ?? false,
        ),
    });
  }

  private handleIntelligenceStoryBeatSelect(index: number): void {
    pinIntelligenceStoryBeat(this.homeIntelligence, index, {
      requestUpdate: () => this.requestUpdate(),
      trackSelection: (beat) =>
        trackHomeStorySelection(
          beat,
          index,
          this.core?.telemetryDisabled ?? false,
        ),
    });
  }

  private syncHomeIntelligenceStory(): void {
    const visible =
      this.isOpen &&
      !this.settingsOpen &&
      this.selectedMenu === "home" &&
      !this._core?.intelligence &&
      typeof document !== "undefined" &&
      document.visibilityState !== "hidden";
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    syncIntelligenceStory(this.homeIntelligence, {
      visible,
      reducedMotion,
      isConnected: () => this.isConnected,
      requestUpdate: () => this.requestUpdate(),
    });
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

  private renderWindow(): TemplateResult {
    const windowState = this.contextState.window;
    const isDocked = this.dockMode !== "floating";
    const isPoppedOut = this.isPoppedOut;
    const isTransitioning = this.hasAttribute("data-transitioning");
    const disableDrag = isDocked || isPoppedOut;

    const windowStyles: Record<string, string> = isPoppedOut
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
        ? {
            ...getDockedWindowStyles(this.dockMode, windowState.size),
            overflowX: "hidden",
          }
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
      ? (this.windowShell.popOutViewportWidth ?? windowState.size.width)
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
            ? renderDockResizeHandle({
                onPointerDown: this.windowShell.handleResizePointerDown,
                onPointerMove: this.windowShell.handleResizePointerMove,
                onPointerUp: this.windowShell.handleResizePointerUp,
                onPointerCancel: this.windowShell.handleResizePointerCancel,
                onKeyDown: this.windowShell.handleResizeKeyDown,
              })
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
            @pointerdown=${
              disableDrag ? undefined : this.windowShell.handlePointerDown
            }
            @pointermove=${
              disableDrag ? undefined : this.windowShell.handlePointerMove
            }
            @pointerup=${
              disableDrag ? undefined : this.windowShell.handlePointerUp
            }
            @pointercancel=${
              disableDrag ? undefined : this.windowShell.handlePointerCancel
            }
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
            : renderFloatingResizeHandles(isDocked, {
                onPointerDown: this.windowShell.handleResizePointerDown,
                onPointerMove: this.windowShell.handleResizePointerMove,
                onPointerUp: this.windowShell.handleResizePointerUp,
                onPointerCancel: this.windowShell.handleResizePointerCancel,
                onKeyDown: this.windowShell.handleResizeKeyDown,
              })
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
    this.windowShell.hydrateEarly(persisted);
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

    this.windowShell.hydrateGeometry(persisted);

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
    const preference = resolveColorSchemePreference(
      persisted,
      this.getSystemColorScheme(),
    );
    this.hasExplicitColorScheme = preference.hasExplicitColorScheme;
    this.colorScheme = preference.colorScheme;
  }

  private getSystemColorScheme(): InspectorColorScheme {
    return getSystemColorScheme(window.matchMedia?.bind(window));
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

  private handleClosePointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  private handleCloseClick = () => {
    this.closeInspector();
  };

  private get isPoppedOut(): boolean {
    return this.windowShell.isPoppedOut;
  }

  private get activeRoot(): ParentNode {
    return this.windowShell.activeRoot;
  }

  private handleAppBeforeUnload = (): void => {
    this.windowShell.closePopOut();
  };
  private persistState(): void {
    const state = buildPersistedShellState({
      contextState: this.contextState,
      hasCustomPosition: this.hasCustomPosition,
      isOpen: this.isOpen,
      dockMode: this.dockMode,
      selectedMenu: this.selectedMenu,
      pendingPersistedMenu: this.pendingPersistedMenu,
      briefingRestoreMenu: this.briefingRestoreMenu,
      selectedContext: this.selectedContext,
      hasOpenedInspector: this.hasOpenedInspector,
      sidebarCollapsed: this.sidebarCollapsed,
      hasExplicitColorScheme: this.hasExplicitColorScheme,
      colorScheme: this.colorScheme,
    });
    saveInspectorState(INSPECTOR_STORAGE_KEY, state);
    this.pendingSelectedContext = state.selectedContext ?? null;
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
    const activeSignalAtOpen = this.launcher.activeSignal;
    const firstOpen = !this.hasOpenedInspector;
    this.hasOpenedInspector = true;
    this.homeViewedThisOpen = false;
    this.launcher.closeHud();

    // A press on the launcher is a gesture towards whatever the dot is about,
    // so it lands where that subject is explained. Restoring a persisted-open
    // panel is not a gesture and deliberately does not route through here.
    // A HUD row sets `hudLandingMenu` and wins, so a red dot cannot steal
    // "Turn on Threads".
    const hudMenu = this.launcher.takeHudLandingMenu();
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

    this.windowShell.open({
      beforePersist: () => this.launcher.cancelGestureTail(),
      afterPersist: () =>
        this.trackOpened(
          source,
          hadUnseenAnnouncement,
          firstOpen,
          activeSignalAtOpen,
        ),
    });
  }

  private closeInspector(): void {
    this.windowShell.close();
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

  private renderWindowLayoutMenu(): TemplateResult {
    return renderWindowLayoutMenu({
      dockMode: this.dockMode,
      open: this.layoutMenuOpen,
      focusStyle: INTERACTIVE_FOCUS_BASE_STYLE,
      renderIcon: (name) => this.renderIcon(name),
      onToggle: this.windowShell.handleLayoutMenuToggle,
      onDock: (mode) => this.windowShell.handleDockClick(mode),
      onPopOut: this.windowShell.requestPopOut,
    });
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
    return buildCoreStatusSummary({
      hasCore: this._core !== null,
      runtimeStatus: this.runtimeStatus,
      lastErrorMessage: this.lastCoreError?.message,
    });
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
      loaded.agentMessages,
      loaded.threadState,
      loaded.agentId,
    );
    this.playground.sourceThreadId = loaded.threadId;
    this.requestUpdate();
  };

  private handleTryFromHere = async (
    threadId: string | null,
  ): Promise<void> => {
    if (!threadId || this.threads.tryFromHereBusy) return;
    const thread =
      this.threads.threads.find((candidate) => candidate.id === threadId) ??
      null;
    if (!thread) return;

    this.threads.tryFromHereBusy = true;
    this.threads.tryFromHereError = null;
    this.requestUpdate();
    const isCurrent = () =>
      this.threads.selectedThreadId === threadId &&
      this.selectedMenu === "threads";

    try {
      const core = this._core;
      if (!core?.runtimeUrl) throw new Error("Failed to load thread.");
      const loaded = await loadPlaygroundThreadSnapshot({
        thread,
        runtimeUrl: core.runtimeUrl,
        headers: core.headers,
        fetch,
      });
      if (isCurrent()) {
        this.startPlaygroundSession(
          false,
          loaded.agentMessages,
          loaded.threadState,
          loaded.agentId,
        );
        this.playground.sourceThreadId = loaded.threadId;
        this.handleMenuSelect("playground");
      }
      if (!this.core?.telemetryDisabled) {
        trackThreadsTryFromHereClicked({
          ...this.getThreadsTelemetryProps(),
          outcome: "success",
        });
      }
    } catch (error) {
      if (isCurrent()) {
        this.threads.tryFromHereError =
          error instanceof Error ? error.message : "Failed to load thread.";
      }
      if (!this.core?.telemetryDisabled) {
        trackThreadsTryFromHereClicked({
          ...this.getThreadsTelemetryProps(),
          outcome: "failure",
        });
      }
    } finally {
      this.threads.tryFromHereBusy = false;
      this.requestUpdate();
    }
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
    return renderShellSettingsPanel({
      optedOut: this.core?.telemetryDisabled ?? false,
      telemetryDocsUrl: TELEMETRY_DOCS_URL,
      renderIcon: (name) => this.renderIcon(name),
    });
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
        tryFromHereAvailable:
          !selectedThreadIsLocalExample &&
          this.areThreadEndpointsAvailable() &&
          this._core?.threadEndpoints?.inspect !== false,
        tryFromHereBusy: this.threads.tryFromHereBusy,
        tryFromHereError: this.threads.tryFromHereError,
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
        tryFromHere: this.handleTryFromHere,
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

  private isErrorSourceBroken(
    source: InspectorWiringErrorSource,
    currentlyArmed: boolean,
  ): boolean {
    if (source === "connection") {
      const state = this.getCoreStatusSummary().state;
      if (runtimeConnectionNeedsAttention(state)) return true;
      return currentlyArmed && state === "connecting";
    }
    return this.threads.threadsErrorByAgent.size > 0;
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
    this.launcher.clearNewsSignal();
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
    const generation = ++this.announcementLoadGeneration;
    this.announcementPromise = this.fetchAnnouncement(generation);
  }

  private async fetchAnnouncement(generation: number): Promise<void> {
    const projection = await loadAnnouncementFeed();
    if (generation !== this.announcementLoadGeneration || !this.isConnected) {
      return;
    }
    this.announcementLoaded = true;
    if (projection.status === "ready") {
      this.announcement = projection;
      if (projection.shouldArm) {
        this.launcher.armNewsSignal({ pulse: projection.shouldPulse });
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

declare global {
  interface HTMLElementTagNameMap {
    "cpk-web-inspector": WebInspectorElement;
  }
}
