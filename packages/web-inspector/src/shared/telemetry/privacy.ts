import {
  getOrCreateTelemetryDistinctId,
  hasTelemetryDisclosureBeenShown,
  isTelemetryOptedOut,
  markTelemetryDisclosureShown,
} from "../persistence/telemetry.js";
import { TELEMETRY_EVENTS, track } from "./transport.js";

const PACKAGE_NAME = "@copilotkit/web-inspector";

// Surfaced in console disclosure and the in-product opt-out panel.
// Keep in sync with the live shell-docs telemetry page
// (`showcase/shell-docs/src/content/docs/integrations/built-in-agent/telemetry.mdx`).
// Mirror constant: packages/runtime/src/v1-deprecated/lib/telemetry-disclosure.ts
export const TELEMETRY_DOCS_URL = "https://docs.copilotkit.ai/telemetry";

export type RuntimeUrlType =
  | "missing"
  | "relative"
  | "localhost"
  | "same_origin"
  | "remote"
  | "invalid";

export function getRuntimeUrlType(
  runtimeUrl: string | undefined,
): RuntimeUrlType {
  if (!runtimeUrl) return "missing";
  if (runtimeUrl.startsWith("/") && !runtimeUrl.startsWith("//")) {
    return "relative";
  }

  try {
    const baseHref =
      typeof window !== "undefined"
        ? window.location.href
        : "https://copilotkit.ai";
    const url = new URL(runtimeUrl, baseHref);
    const baseUrl = new URL(baseHref);
    const hostname = url.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    ) {
      return "localhost";
    }

    return url.origin === baseUrl.origin ? "same_origin" : "remote";
  } catch {
    return "invalid";
  }
}

// --- Typed per-event helpers ---
// These enforce the known property shape for each V1 event at the call
// site, so callers can't accidentally include PII under a wrong key.

/**
 * Where an announcement was rendered when the event fired. What's new is the
 * only surface that carries one, so the value is currently a constant — it
 * stays a stamped property rather than an inferred one so a second surface
 * can be added without changing the event's shape.
 */
export type WhatsNewSurface = "whats_new";

/**
 * Whether a launcher signal was animated, or held static because the reader
 * asked for reduced motion. Shared by every launcher signal so an
 * accessibility setting is never mistaken for disinterest.
 */
export type LauncherSignalPresentation = "animated" | "reduced_motion";

export type WhatsNewSignalPresentation = LauncherSignalPresentation;

/**
 * Which failure class raised the launcher's error signal. A closed enum: the
 * failure *message* is never transmitted, so prompts, URLs and identifiers
 * embedded in an error cannot leave the browser.
 *
 * `connection` and `threads` are wiring *state*. `run`, `tool` and `memory`
 * are unread *events* that clear when their landing view is read.
 */
export type InspectorWiringErrorSource = "connection" | "threads";
export type InspectorEventErrorSource = "run" | "tool" | "memory";
export type InspectorErrorSignalSource =
  | InspectorWiringErrorSource
  | InspectorEventErrorSource;

/**
 * Fires when What's new has rendered *with content*. A loading state is not
 * an impression, so the metric cannot inflate itself by counting readers who
 * arrived before the feed resolved.
 */
export function trackWhatsNewViewed(props: {
  banner_id: string;
  surface: WhatsNewSurface;
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.whatsNewViewed, props);
}

/** Fires when the unread launcher signal is presented in a visible tab. */
export function trackWhatsNewSignalViewed(props: {
  banner_id: string;
  surface: "launcher";
  presentation: WhatsNewSignalPresentation;
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.whatsNewSignalViewed, props);
}

/**
 * Whether the launcher opened its pill for this outage, or suppressed it.
 *
 * `suppressed` means no pill was shown. In practice that is the no-room
 * fallback — neither side of the launcher had space for the label — because
 * every other path to a visible error signal opens one.
 */
export type InspectorErrorSignalLabel = "shown" | "suppressed";

/**
 * Fires when the launcher's error signal becomes *visible* — not when it arms.
 * Arming can happen with the panel open or the tab hidden, where there is no
 * launcher to look at, so counting arms would inflate the denominator this
 * event exists to provide.
 *
 * Deliberately carries three fixed enum values and nothing else. This is the
 * one place a later change could casually attach a free-text field, and the
 * failure message must never be transmitted.
 *
 * `label` is deliberately not a new event: the catalogue's size is asserted
 * and spelled out in a test title, and a property answers the one open
 * question — how often the no-room fallback fires — without touching either.
 *
 * The pill's own marginal effect cannot be measured here and must not be
 * reverse-engineered from this data: it ships together with the dot and the
 * beat, so there is no period with one and not the other.
 */
export function trackErrorSignalViewed(props: {
  source: InspectorErrorSignalSource;
  presentation: LauncherSignalPresentation;
  label: InspectorErrorSignalLabel;
}): void {
  track(TELEMETRY_EVENTS.errorSignalViewed, {
    source: props.source,
    presentation: props.presentation,
    label: props.label,
  });
}

/**
 * Fires for links followed inside the announcement body. `body` is the only
 * call-to-action left: dismissal no longer exists, so there is nothing else a
 * click on this surface can mean.
 */
export function trackWhatsNewClicked(props: {
  banner_id: string;
  cta: "body";
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.whatsNewClicked, props);
}

/**
 * How the panel was opened. Restoring a persisted-open panel on mount is
 * deliberately NOT a source: it is not an open *intent*, and counting it
 * would turn every dev-server hot reload into an "open".
 */
export type InspectorOpenSource = "floating_button" | "message_toolbar";

export type InspectorOpenedTelemetryProps = {
  open_source: InspectorOpenSource;
  package_name?: typeof PACKAGE_NAME;
  package_version?: string;
  inspector_distinct_id?: string;
  license_status?:
    | "valid"
    | "none"
    | "expired"
    | "expiring"
    | "invalid"
    | "unknown";
  runtime_mode?: "sse" | "intelligence";
  runtime_url_type?: RuntimeUrlType;
  /** True when an unseen announcement was on screen at open time. */
  has_unseen_announcement?: boolean;
  /** True when an error signal was on the launcher at open time. */
  has_error_signal?: boolean;
  /** Which failure class was signalling at open time, when one was. */
  error_signal_source?: InspectorErrorSignalSource;
  /** True when this is the first Inspector open after install or upgrade. */
  first_open?: boolean;
};

/**
 * Panel-open signal (OSS-566). Before this event, opens could only be
 * inferred from in-panel activity (a floor) or from the announcement's own
 * click event (which misses the floating-button path entirely).
 */
export function trackInspectorOpened(
  props: InspectorOpenedTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.opened, props);
}

export type ExampleKind = "realtime_sync" | "manage_history" | "inspect_runs";
export type ThreadsUsageBucket =
  | "absent"
  | "empty"
  | "within_limit"
  | "at_or_over_limit"
  | "unlimited"
  | "unknown_limit";
export type ThreadsExpiryBucket = "unavailable" | "zero" | "positive";
export type InspectorGroupKey = "home" | "workbench" | "inspect";
export type InspectorLeafKey =
  | "home"
  | "whats-new"
  | "playground"
  | "threads"
  | "ag-ui-events"
  | "agents"
  | "frontend-tools"
  | "capabilities"
  | "agent-context"
  | "memories";
export type MetadataActionPlacement = "threads_footer" | "threads_locked";
export type ExampleTourStep = 1 | 2 | 3;
export type ExampleTourTab = "timeline" | "raw-events" | "state";

export type InspectorThreadTelemetryProps = Readonly<{
  posthog_distinct_id?: string;
  intelligence_status?:
    | "intelligence_not_enabled"
    | "intelligence_enabled"
    | "unknown";
  thread_service_status?: "unavailable" | "available" | "unknown" | "error";
  license_status?:
    | "valid"
    | "none"
    | "expired"
    | "expiring"
    | "invalid"
    | "unknown";
  runtime_mode?: "sse" | "intelligence";
  runtime_url_type?: RuntimeUrlType;
  cta_surface?:
    | "threads_locked"
    | "threads_header"
    | "threads_empty"
    | "threads_populated"
    | "sidebar_footer";
  cta?: "signup" | "talk_to_engineer";
  telemetry_disabled?: boolean;
  has_threads?: boolean;
  usage_bucket?: ThreadsUsageBucket;
  expiry_bucket?: ThreadsExpiryBucket;
  group_key?: InspectorGroupKey;
  leaf_key?: InspectorLeafKey;
  example_kind?: ExampleKind;
  tour_step?: ExampleTourStep;
  tour_tab?: ExampleTourTab;
  dismiss_method?: "skip" | "done";
  outcome?: "success" | "failure";
}>;

/** Rebuild the common Thread payload from its closed coarse allowlist. */
function threadCommonProperties(props: InspectorThreadTelemetryProps) {
  return {
    ...(props.intelligence_status === undefined
      ? {}
      : { intelligence_status: props.intelligence_status }),
    ...(props.thread_service_status === undefined
      ? {}
      : { thread_service_status: props.thread_service_status }),
    ...(props.license_status === undefined
      ? {}
      : { license_status: props.license_status }),
    ...(props.runtime_mode === undefined
      ? {}
      : { runtime_mode: props.runtime_mode }),
    ...(props.runtime_url_type === undefined
      ? {}
      : { runtime_url_type: props.runtime_url_type }),
    ...(props.telemetry_disabled === undefined
      ? {}
      : { telemetry_disabled: props.telemetry_disabled }),
    ...(props.has_threads === undefined
      ? {}
      : { has_threads: props.has_threads }),
    ...(props.usage_bucket === undefined
      ? {}
      : { usage_bucket: props.usage_bucket }),
    ...(props.expiry_bucket === undefined
      ? {}
      : { expiry_bucket: props.expiry_bucket }),
    ...(props.group_key === undefined ? {} : { group_key: props.group_key }),
    ...(props.leaf_key === undefined ? {} : { leaf_key: props.leaf_key }),
  };
}

/** Add only the fields used by the three Thread CTA funnels. */
function threadCtaProperties(props: InspectorThreadTelemetryProps) {
  return {
    ...threadCommonProperties(props),
    ...(props.cta === undefined ? {} : { cta: props.cta }),
    ...(props.cta_surface === undefined
      ? {}
      : { cta_surface: props.cta_surface }),
    ...(props.posthog_distinct_id === undefined
      ? {}
      : { posthog_distinct_id: props.posthog_distinct_id }),
  };
}

/** Add only the closed example kind used by example impressions/selections. */
function threadExampleProperties(props: InspectorThreadTelemetryProps) {
  return {
    ...threadCommonProperties(props),
    ...(props.example_kind === undefined
      ? {}
      : { example_kind: props.example_kind }),
  };
}

/** Add only a bounded example kind and tour step/tab pair. */
function threadTourProperties(props: InspectorThreadTelemetryProps) {
  return {
    ...threadExampleProperties(props),
    ...(props.tour_step === undefined ? {} : { tour_step: props.tour_step }),
    ...(props.tour_tab === undefined ? {} : { tour_tab: props.tour_tab }),
  };
}

/** Add the bounded dismissal leaf used only by terminal tour events. */
function threadTourTerminalProperties(props: InspectorThreadTelemetryProps) {
  return {
    ...threadTourProperties(props),
    ...(props.dismiss_method === undefined
      ? {}
      : { dismiss_method: props.dismiss_method }),
  };
}

export function trackThreadsTabClicked(
  props: InspectorThreadTelemetryProps = {},
): void {
  track(TELEMETRY_EVENTS.threadsTabClicked, threadCommonProperties(props));
}

export function trackThreadsTryFromHereClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsTryFromHereClicked, {
    ...threadCommonProperties(props),
    ...(props.outcome === undefined ? {} : { outcome: props.outcome }),
  });
}

export function trackThreadsLockedViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsLockedViewed, threadCommonProperties(props));
}

export function trackThreadsIntelligenceSignupClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsIntelligenceSignupClicked,
    threadCtaProperties(props),
  );
}

export function trackThreadsTalkToEngineerClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsTalkToEngineerClicked,
    threadCtaProperties(props),
  );
}

export function trackTalkToEngineerClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.talkToEngineerClicked, threadCtaProperties(props));
}

export function trackThreadsEmptyEnabledViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
    threadCommonProperties(props),
  );
}

export function trackThreadsEnabledViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsEnabledViewed, threadCommonProperties(props));
}

export function trackThreadsExampleViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleViewed, threadExampleProperties(props));
}

export function trackThreadsExampleSelected(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsExampleSelected,
    threadExampleProperties(props),
  );
}

export function trackThreadsExampleTourStarted(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsExampleTourStarted,
    threadTourProperties(props),
  );
}

export function trackThreadsExampleTourStepViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsExampleTourStepViewed,
    threadTourProperties(props),
  );
}

export function trackThreadsExampleTourDismissed(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsExampleTourDismissed,
    threadTourTerminalProperties(props),
  );
}

export function trackThreadsExampleTourCompleted(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsExampleTourCompleted,
    threadTourTerminalProperties(props),
  );
}

export function trackThreadsExampleTourReopened(
  props: InspectorThreadTelemetryProps,
): void {
  track(
    TELEMETRY_EVENTS.threadsExampleTourReopened,
    threadTourProperties(props),
  );
}

export type InspectorMemoryTelemetryProps = {
  package_name?: typeof PACKAGE_NAME;
  package_version?: string;
  inspector_distinct_id?: string;
  posthog_distinct_id?: string;
  memory_count?: number;
  available?: boolean;
};

export function trackMemoriesTabClicked(
  props: InspectorMemoryTelemetryProps = {},
): void {
  track(TELEMETRY_EVENTS.memoriesTabClicked, props);
}

export type InspectorMetadataTelemetryModule = "identity" | "plan" | "action";
export type InspectorMetadataLicenseBucket =
  | "valid"
  | "none"
  | "expired"
  | "unknown";
export type InspectorMetadataActionKind =
  | "manage_plan"
  | "renew"
  | "enable_intelligence";

export type InspectorHomeTelemetryProps = Readonly<{
  action_kind?: InspectorMetadataActionKind;
  group_key?: InspectorGroupKey;
  leaf_key?: InspectorLeafKey;
}>;

export function trackHomeViewed(props: InspectorHomeTelemetryProps = {}): void {
  track(TELEMETRY_EVENTS.homeViewed, {
    group_key: props.group_key ?? "home",
    leaf_key: props.leaf_key ?? "home",
  });
}

export function trackHomeCtaClicked(props: InspectorHomeTelemetryProps): void {
  track(TELEMETRY_EVENTS.homeCtaClicked, {
    action_kind: props.action_kind,
    group_key: props.group_key ?? "home",
    leaf_key: props.leaf_key ?? "home",
  });
}

/**
 * Correlates a copied feature setup prompt with its onboarding run. The run ID
 * is generated locally for this click, not derived from account or runtime
 * data, so it can be safely joined with the onboarding flow downstream.
 */
export function trackHomeFeaturePromptClicked(props: {
  feature_id: string;
  onboarding_run_id: string;
}): void {
  track(TELEMETRY_EVENTS.homeFeaturePromptClicked, {
    feature_id: props.feature_id,
    onboarding_run_id: props.onboarding_run_id,
    group_key: "home",
    leaf_key: "home",
  });
}

export type InspectorHomePromptCopiedTelemetryProps = Readonly<{
  /** The id minted for this session and substituted into the copied prompt. */
  onboarding_run_id: string;
  /** Whether the clipboard write actually landed. */
  outcome: "copied" | "failed";
}>;

/**
 * Report a copy of the Intelligence install prompt.
 *
 * `outcome` is reported rather than only emitting on success, because a
 * clipboard that refuses is indistinguishable from a developer who never
 * pressed the button — and the two call for opposite fixes.
 */
export function trackHomePromptCopied(
  props: InspectorHomePromptCopiedTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.homePromptCopied, {
    onboarding_run_id: props.onboarding_run_id,
    outcome: props.outcome,
    group_key: "home",
    leaf_key: "home",
  });
}

export type InspectorHomeStoryBeatTelemetryProps = Readonly<{
  /** Stable id of the step, e.g. "threads". Survives a label rename. */
  beat: string;
  /** Its position in the rail, so a reorder can be evaluated against clicks. */
  beat_index: number;
}>;

/**
 * Report a step of the Intelligence story that a developer opened themselves.
 *
 * Only a press reports. The story also advances on its own every few seconds,
 * and reporting that would bury the handful of real interactions under a
 * metronome — one event per idle developer per six seconds, none of it intent.
 */
export function trackHomeStoryBeatSelected(
  props: InspectorHomeStoryBeatTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.homeStoryBeatSelected, {
    beat: props.beat,
    beat_index: props.beat_index,
    group_key: "home",
    leaf_key: "home",
  });
}

export type InspectorMetadataModuleViewedTelemetryProps = Readonly<{
  module: InspectorMetadataTelemetryModule;
  license_bucket: InspectorMetadataLicenseBucket;
  action_kind?: InspectorMetadataActionKind;
  usage_bucket: ThreadsUsageBucket;
  expiry_bucket: ThreadsExpiryBucket;
  group_key?: InspectorGroupKey;
  leaf_key?: InspectorLeafKey;
  action_placement?: MetadataActionPlacement;
}>;

export type InspectorMetadataActionClickedTelemetryProps = Readonly<{
  action_kind: Exclude<InspectorMetadataActionKind, "enable_intelligence">;
  license_bucket: InspectorMetadataLicenseBucket;
  usage_bucket: ThreadsUsageBucket;
  expiry_bucket: ThreadsExpiryBucket;
  group_key?: InspectorGroupKey;
  leaf_key?: InspectorLeafKey;
  action_placement?: MetadataActionPlacement;
}>;

function metadataCoarseProperties(
  props:
    | InspectorMetadataModuleViewedTelemetryProps
    | InspectorMetadataActionClickedTelemetryProps,
) {
  const navigation =
    props.group_key === undefined || props.leaf_key === undefined
      ? {}
      : { group_key: props.group_key, leaf_key: props.leaf_key };
  return {
    license_bucket: props.license_bucket,
    usage_bucket: props.usage_bucket,
    expiry_bucket: props.expiry_bucket,
    ...navigation,
    ...(props.action_placement === undefined
      ? {}
      : { action_placement: props.action_placement }),
  };
}

/**
 * Tracks one visible Inspector metadata module using coarse fields only.
 * Rebuilding the payload here prevents local labels, IDs, URLs, and usage
 * values from crossing the telemetry boundary through extra object fields.
 */
export function trackMetadataModuleViewed(
  props: InspectorMetadataModuleViewedTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.metadataModuleViewed, {
    module: props.module,
    ...(props.action_kind === undefined
      ? {}
      : { action_kind: props.action_kind }),
    ...metadataCoarseProperties(props),
  });
}

/**
 * Tracks clicks for managed plan and renewal actions. The existing
 * Intelligence-enable funnel keeps its original event and never calls this
 * helper, which prevents a single click from producing two wire events.
 */
export function trackMetadataActionClicked(
  props: InspectorMetadataActionClickedTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.metadataActionClicked, {
    module: "action",
    action_kind: props.action_kind,
    ...metadataCoarseProperties(props),
  });
}

/**
 * Returns the inspector's anonymous distinct-ID for cross-domain
 * propagation onto outbound announcement-CTA links, or `null` when the user
 * is opted out.
 *
 * The website / Ops API reads this query param on signup-flow landing
 * pages and calls `posthog.alias(...)` to merge the inspector's anon
 * ID with the website's anon ID, enabling the
 * `whats_new_viewed → whats_new_clicked → signup_attributed` funnel.
 * `identify()` itself is out of scope here (it happens on signup, in
 * the website / Ops API).
 *
 * Opt-out short-circuits this too: if the user has opted out, we do
 * NOT leak an anon ID across domains.
 */
export function getTelemetryDistinctIdForUrl(): string | null {
  if (isTelemetryOptedOut()) return null;
  return getOrCreateTelemetryDistinctId();
}

/**
 * Seeds the anonymous distinct-ID into localStorage on inspector mount
 * so it is ready for cross-domain propagation onto announcement-CTA links
 * even before the first event fires. No-op when the user has opted out.
 */
export function ensureTelemetryDistinctId(): void {
  if (isTelemetryOptedOut()) return;
  getOrCreateTelemetryDistinctId();
}

/**
 * Fires the one-time console disclosure on inspector mount, when the
 * user is not opted out and hasn't seen it before. Idempotent across
 * calls within a single session because `markTelemetryDisclosureShown`
 * persists to localStorage.
 *
 * If the user is opted out, we deliberately do nothing and do NOT mark
 * the flag — so a future opt-in flips back to "first run" behavior.
 */
export function maybeShowDisclosure(): void {
  if (isTelemetryOptedOut()) return;
  if (hasTelemetryDisclosureBeenShown()) return;
  // eslint-disable-next-line no-console
  console.info(
    `[CopilotKit Inspector] anonymous interaction telemetry enabled — see ${TELEMETRY_DOCS_URL} to opt out.`,
  );
  markTelemetryDisclosureShown();
}

export { isTelemetryOptedOut };
