// Inspector-side anonymous telemetry. V1 events fire from index.ts for
// banner and thread-inspection interactions. POSTs directly from the browser
// to the CopilotKit telemetry sink at `telemetry.copilotkit.ai/ingest`,
// where a Lambda fan-out forwards events to PostHog / Reo / Scarf.
//
// The endpoint URL is intentionally clearly named so it's obvious in
// DevTools / Network tab — transparency for opt-in users.
//
// Privacy invariants enforced here:
//   - We never send message content, agent state, prompts, completions,
//     or banner markdown. Properties are scoped to event metadata only
//     (banner_id/timestamp, cta location). Reviewers should grep call
//     sites for any unintended payload.
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
  bannerViewed: "oss.inspector.banner_viewed",
  bannerClicked: "oss.inspector.banner_clicked",
  bannerDismissed: "oss.inspector.banner_dismissed",
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
} as const;

export type TelemetryEvent =
  (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

// Per the OSS-96 ticket — the URL is intentionally clearly named for
// transparency in the network tab.
export const TELEMETRY_INGEST_URL = "https://telemetry.copilotkit.ai/ingest";

// Surfaced in console disclosure and the in-product opt-out panel.
// Keep in sync with the canonical telemetry docs page on main
// (`docs/content/docs/(root)/(other)/telemetry/index.mdx`).
// Mirror constant: packages/runtime/src/lib/telemetry-disclosure.ts
export const TELEMETRY_DOCS_URL = "https://docs.copilotkit.ai/telemetry";

const PACKAGE_NAME = "@copilotkit/web-inspector";
const PACKAGE_VERSION = packageJson.version;

// 3-second cap so a slow gateway can't hang the host app. Matches the
// runtime's existing scarf-client convention.
const FETCH_TIMEOUT_MS = 3000;

// Events that carry package identity (`package_name` / `package_version`) and
// the inspector's anonymous distinct-ID alongside their own properties.
// Threads / memories events have always been enriched this way; `opened`
// joins them so panel-open volume can be segmented by inspector version.
// Banner events deliberately keep the flat shape their existing dashboards
// read.
function isEnrichedTelemetryEvent(event: TelemetryEvent): boolean {
  return (
    event === TELEMETRY_EVENTS.opened ||
    event === TELEMETRY_EVENTS.threadsTabClicked ||
    event === TELEMETRY_EVENTS.threadsLockedViewed ||
    event === TELEMETRY_EVENTS.threadsIntelligenceSignupClicked ||
    event === TELEMETRY_EVENTS.threadsTalkToEngineerClicked ||
    event === TELEMETRY_EVENTS.talkToEngineerClicked ||
    event === TELEMETRY_EVENTS.threadsEmptyEnabledViewed ||
    event === TELEMETRY_EVENTS.threadsEnabledViewed ||
    event === TELEMETRY_EVENTS.threadsExampleViewed ||
    event === TELEMETRY_EVENTS.threadsExampleSelected ||
    event === TELEMETRY_EVENTS.threadsExampleTourStarted ||
    event === TELEMETRY_EVENTS.threadsExampleTourStepViewed ||
    event === TELEMETRY_EVENTS.threadsExampleTourDismissed ||
    event === TELEMETRY_EVENTS.threadsExampleTourCompleted ||
    event === TELEMETRY_EVENTS.threadsExampleTourReopened ||
    event === TELEMETRY_EVENTS.memoriesTabClicked
  );
}

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

// --- Runtime egress gate ---
//
// The runtime's opt-out (`COPILOTKIT_TELEMETRY_DISABLED` / `DO_NOT_TRACK`,
// OSS-565) is only KNOWN once the /info handshake lands. Until then
// `CopilotKitCore.telemetryDisabled` reports `false` as a placeholder, so a
// per-call-site `if (telemetryDisabled) return` check passes and the event
// goes out — even when /info is about to report that telemetry is off.
//
// The gate lives here, at the single egress boundary, rather than at the 15+
// call sites: nothing reaches the network until the host resolves it. Events
// raised while the decision is unknown are held, then released or dropped.
//
// Consequence worth knowing: if a runtime never connects, inspector telemetry
// stays silent for that session. That is the intended trade — we cannot
// establish consent without the handshake.
export type TelemetryGateDecision = "allowed" | "denied";

let gateDecision: TelemetryGateDecision | null = null;

type HeldEvent = {
  event: TelemetryEvent;
  properties: Record<string, unknown>;
  // Stamped when the event happened, not when it is released — otherwise every
  // held event would carry the handshake's completion time instead of the
  // user's interaction time.
  ts: number;
};

// Bounded: a host that never resolves the gate must not accumulate events
// without limit. Overflow is dropped — these are signals, not a ledger.
const MAX_HELD_EVENTS = 20;
let heldEvents: HeldEvent[] = [];

/**
 * Records the runtime's telemetry decision and releases anything held while
 * it was unknown. Call with `"denied"` when the runtime reports
 * `telemetryDisabled`, `"allowed"` when it reports the opposite — only after
 * the /info handshake has actually completed.
 */
export function resolveTelemetryGate(decision: TelemetryGateDecision): void {
  gateDecision = decision;
  const held = heldEvents;
  heldEvents = [];
  if (decision === "denied") return;
  // Re-checked here, not just at hold time: the user may have opted out while
  // the handshake was still outstanding.
  if (isTelemetryOptedOut()) return;
  for (const { event, properties, ts } of held) send(event, properties, ts);
}

/**
 * Returns the gate to its unresolved state and discards anything held. Called
 * when the inspector detaches from a core, so a later core starts from "we do
 * not know" rather than inheriting the previous runtime's decision.
 */
export function resetTelemetryGate(): void {
  gateDecision = null;
  heldEvents = [];
}

/**
 * Fire-and-forget telemetry send. Returns synchronously; the network
 * call is dispatched in the background and any failure is swallowed.
 *
 * Short-circuits when the user has opted out, and holds the event when the
 * runtime's own opt-out is not yet known (see the egress gate above). Does
 * NOT itself trigger the first-run disclosure — call `maybeShowDisclosure()`
 * from the inspector's mount lifecycle instead.
 */
export function track(
  event: TelemetryEvent,
  properties: Record<string, unknown> = {},
): void {
  if (isTelemetryOptedOut()) return;
  if (gateDecision === "denied") return;
  const ts = Math.floor(Date.now() / 1000);
  if (gateDecision === null) {
    if (heldEvents.length < MAX_HELD_EVENTS) {
      heldEvents.push({ event, properties, ts });
    }
    return;
  }
  send(event, properties, ts);
}

function send(
  event: TelemetryEvent,
  properties: Record<string, unknown>,
  ts: number,
): void {
  const distinctId = getOrCreateTelemetryDistinctId();
  const enrichedProperties = isEnrichedTelemetryEvent(event)
    ? {
        package_name: PACKAGE_NAME,
        package_version: PACKAGE_VERSION,
        inspector_distinct_id: distinctId,
      }
    : {};
  let body: string;
  try {
    body = JSON.stringify({
      event,
      properties: {
        ...properties,
        ...enrichedProperties,
        distinct_id: distinctId,
      },
      package: {
        name: PACKAGE_NAME,
        ...(isEnrichedTelemetryEvent(event)
          ? { version: PACKAGE_VERSION }
          : {}),
      },
      ts,
    });
  } catch {
    return;
  }

  void postBestEffort(TELEMETRY_INGEST_URL, body, distinctId);
}

// --- Typed per-event helpers ---
// These enforce the known property shape for each V1 event at the call
// site, so callers can't accidentally include PII under a wrong key.

/**
 * Where an announcement was rendered when the event fired. The announcement
 * has two surfaces — the preview bubble beside the *collapsed* floating
 * button, and the card *inside* the opened panel — and reach on one says
 * nothing about attention on the other. Always stamped at fire time, never
 * inferred at fetch time.
 */
export type BannerSurface = "collapsed_preview" | "expanded_card";

export function trackBannerViewed(props: {
  banner_id: string;
  surface: BannerSurface;
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.bannerViewed, props);
}

export function trackBannerClicked(props: {
  banner_id: string;
  cta: "body" | "dismiss";
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.bannerClicked, props);
}

/**
 * First-class dismissal signal. Emitted *in addition to*
 * `banner_clicked { cta: "dismiss" }` rather than replacing it — the
 * existing dashboards read the `cta` value, so removing it would silently
 * zero them out. New reporting should prefer this event, whose `surface`
 * says whether the user swatted the bubble away or dismissed the card
 * after opening the panel.
 */
export function trackBannerDismissed(props: {
  banner_id: string;
  surface: BannerSurface;
  cta_label?: string;
}): void {
  track(TELEMETRY_EVENTS.bannerDismissed, props);
}

/**
 * How the panel was opened. Restoring a persisted-open panel on mount is
 * deliberately NOT a source: it is not an open *intent*, and counting it
 * would turn every dev-server hot reload into an "open".
 */
export type InspectorOpenSource = "floating_button" | "announcement_preview";

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
};

/**
 * Panel-open signal (OSS-566). Before this event, opens could only be
 * inferred from in-panel activity (a floor) or from `banner_clicked`
 * cta=`body` (which misses the floating-button path entirely).
 */
export function trackInspectorOpened(
  props: InspectorOpenedTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.opened, props);
}

export type InspectorThreadTelemetryProps = {
  package_name?: typeof PACKAGE_NAME;
  package_version?: string;
  inspector_distinct_id?: string;
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
    | "threads_populated";
  cta?: "signup" | "talk_to_engineer";
  telemetry_disabled?: boolean;
  thread_count?: number;
  example_thread_id?: string;
  tour_step?: number;
  tour_tab?: "timeline" | "raw-events" | "state";
  dismiss_method?: "skip" | "done";
};

export function trackThreadsTabClicked(
  props: InspectorThreadTelemetryProps = {},
): void {
  track(TELEMETRY_EVENTS.threadsTabClicked, props);
}

export function trackThreadsLockedViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsLockedViewed, props);
}

export function trackThreadsIntelligenceSignupClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsIntelligenceSignupClicked, props);
}

export function trackThreadsTalkToEngineerClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsTalkToEngineerClicked, props);
}

export function trackTalkToEngineerClicked(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.talkToEngineerClicked, props);
}

export function trackThreadsEmptyEnabledViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsEmptyEnabledViewed, props);
}

export function trackThreadsEnabledViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsEnabledViewed, props);
}

export function trackThreadsExampleViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleViewed, props);
}

export function trackThreadsExampleSelected(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleSelected, props);
}

export function trackThreadsExampleTourStarted(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleTourStarted, props);
}

export function trackThreadsExampleTourStepViewed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleTourStepViewed, props);
}

export function trackThreadsExampleTourDismissed(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleTourDismissed, props);
}

export function trackThreadsExampleTourCompleted(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleTourCompleted, props);
}

export function trackThreadsExampleTourReopened(
  props: InspectorThreadTelemetryProps,
): void {
  track(TELEMETRY_EVENTS.threadsExampleTourReopened, props);
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

/**
 * Returns the inspector's anonymous distinct-ID for cross-domain
 * propagation onto outbound banner-CTA links, or `null` when the user
 * is opted out.
 *
 * The website / Ops API reads this query param on signup-flow landing
 * pages and calls `posthog.alias(...)` to merge the inspector's anon
 * ID with the website's anon ID, enabling the
 * `banner_viewed → banner_clicked → signup_attributed` funnel.
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
 * so it is ready for cross-domain propagation onto banner-CTA links
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
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
    clearTimeout(timeoutId);
  }
}
