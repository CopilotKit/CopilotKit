// Inspector-side anonymous telemetry. V1 events fire from index.ts for
// What's new and thread-inspection interactions. POSTs directly from the
// browser to the CopilotKit telemetry sink at
// `telemetry.copilotkit.ai/ingest`, where a Lambda fan-out forwards events to
// PostHog / Reo / Scarf.
//
// The endpoint URL is intentionally clearly named so it's obvious in
// DevTools / Network tab — transparency for opt-in users.
//
// Privacy invariants enforced here:
//   - We never send message content, agent state, prompts, completions,
//     or announcement markdown. Feature-specific properties are scoped to
//     event metadata only (banner_id/timestamp, cta location). Reviewers
//     should grep call sites for any unintended payload.
//   - The opt-out short-circuits before any network call. There is no
//     buffer, no retry queue.
//   - All errors are swallowed; telemetry must never break the host app.

import {
  getOrCreateTelemetryDistinctId,
  hasTelemetryDisclosureBeenShown,
  isTelemetryOptedOut,
  markTelemetryDisclosureShown,
} from "./persistence.js";
import packageJson from "../../package.json" with { type: "json" };

// V1 funnel events. Namespaced `oss.inspector.*` so the lambda's
// owned-prefix gate (oss-path-to-production) can accept them server-side
// without a per-event sink deploy.
export const TELEMETRY_EVENTS = {
  opened: "oss.inspector.opened",
  whatsNewViewed: "oss.inspector.whats_new_viewed",
  whatsNewSignalViewed: "oss.inspector.whats_new_signal_viewed",
  errorSignalViewed: "oss.inspector.error_signal_viewed",
  whatsNewClicked: "oss.inspector.whats_new_clicked",
  threadsTabClicked: "oss.inspector.threads_tab_clicked",
  threadsLockedViewed: "oss.inspector.threads_locked_viewed",
  threadsIntelligenceSignupClicked:
    "oss.inspector.threads_intelligence_signup_clicked",
  threadsTalkToEngineerClicked:
    "oss.inspector.threads_talk_to_engineer_clicked",
  talkToEngineerClicked: "oss.inspector.talk_to_engineer_clicked",
  threadsEmptyEnabledViewed: "oss.inspector.threads_empty_enabled_viewed",
  threadsEnabledViewed: "oss.inspector.threads_enabled_viewed",
  threadsExampleViewed: "oss.inspector.threads_example_viewed",
  threadsExampleSelected: "oss.inspector.threads_example_selected",
  threadsExampleTourStarted: "oss.inspector.threads_example_tour_started",
  threadsExampleTourStepViewed:
    "oss.inspector.threads_example_tour_step_viewed",
  threadsExampleTourDismissed: "oss.inspector.threads_example_tour_dismissed",
  threadsExampleTourCompleted: "oss.inspector.threads_example_tour_completed",
  threadsExampleTourReopened: "oss.inspector.threads_example_tour_reopened",
  memoriesTabClicked: "oss.inspector.memories_tab_clicked",
  homeViewed: "oss.inspector.home_viewed",
  homeCtaClicked: "oss.inspector.home_cta_clicked",
  metadataModuleViewed: "oss.inspector.metadata_module_viewed",
  metadataActionClicked: "oss.inspector.metadata_action_clicked",
} as const;

export type TelemetryEvent =
  (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

// Per the OSS-96 ticket — the URL is intentionally clearly named for
// transparency in the network tab.
export const TELEMETRY_INGEST_URL = "https://telemetry.copilotkit.ai/ingest";

// Surfaced in console disclosure and the in-product opt-out panel.
// Keep in sync with the live shell-docs telemetry page
// (`showcase/shell-docs/src/content/docs/integrations/built-in-agent/telemetry.mdx`).
// Mirror constant: packages/runtime/src/lib/telemetry-disclosure.ts
export const TELEMETRY_DOCS_URL = "https://docs.copilotkit.ai/telemetry";

const PACKAGE_NAME = "@copilotkit/web-inspector";
const PACKAGE_VERSION = packageJson.version;

// 3-second cap so a slow gateway can't hang the host app. Matches the
// runtime's existing scarf-client convention.
const FETCH_TIMEOUT_MS = 3000;

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

/**
 * Fire-and-forget telemetry send. Returns synchronously; the network
 * call is dispatched in the background and any failure is swallowed.
 *
 * Short-circuits when the user has opted out. Does NOT itself trigger
 * the first-run disclosure — call `maybeShowDisclosure()` from the
 * inspector's mount lifecycle instead.
 */
export function track(
  event: TelemetryEvent,
  properties: Record<string, unknown> = {},
): void {
  if (isTelemetryOptedOut()) return;

  try {
    const distinctId = getOrCreateTelemetryDistinctId();
    // Every event carries package identity and the inspector's anonymous
    // distinct-ID, so any of them can be segmented by inspector version.
    const body = JSON.stringify({
      event,
      properties: {
        ...properties,
        package_name: PACKAGE_NAME,
        package_version: PACKAGE_VERSION,
        inspector_distinct_id: distinctId,
        distinct_id: distinctId,
      },
      package: {
        name: PACKAGE_NAME,
        version: PACKAGE_VERSION,
      },
      ts: Math.floor(Date.now() / 1000),
    });
    void postBestEffort(TELEMETRY_INGEST_URL, body, distinctId);
  } catch {
    // Identity and serialization failures are best-effort too.
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
 * Which broken-wiring class raised the launcher's error signal. A closed
 * two-value enum: the failure *message* is never transmitted, so prompts,
 * URLs and identifiers embedded in an error cannot leave the browser.
 */
export type InspectorErrorSignalSource = "connection" | "threads";

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
  /** True when a broken-wiring signal was on the launcher at open time. */
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

async function postBestEffort(
  url: string,
  body: string,
  distinctId: string,
): Promise<void> {
  if (typeof fetch === "undefined") return;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CopilotKit-Telemetry-Id": distinctId,
      },
      body,
      signal: controller.signal,
      // No credentials / no Authorization header — anonymous endpoint.
    });
  } catch {
    // Silent failure — telemetry must not break the application.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
